"""Page-limited payment diagnostics; reference amounts never alter calendar flows."""

from collections import defaultdict
from dataclasses import asdict

from .contracts import CellDetailsResponse, PaymentStageResponse
from .model import ZERO, Filters, Link, Request, Snapshot, allocate, decimal
from .sources import Loader, chunks

STAGE_TYPES = ("Payment Request", "Payment Order", "Payment Entry", "Journal Entry")


def stage_links(row):
	links = [row["source"], row.get("payment"), row.get("date_source"), *row["links"]]
	return sorted(
		{Link(link["doctype"], link["name"]) for link in links if link and link["doctype"] in STAGE_TYPES},
		key=lambda link: (STAGE_TYPES.index(link.doctype), link.name),
	)


def request_reference(request: Request, row) -> Link | None:
	"""Accept only one explicit invoice or a directly represented standalone request."""
	invoice = row["analytic"].get("invoice")
	if request.invoice_only and len(request.coverage) == 1 and invoice:
		link = Link(invoice["doctype"], invoice["name"])
		return link if link in request.coverage else None
	if not request.invoice_only and not request.coverage and row["source"] == asdict(request.source):
		orders = {share.analytic.order for share in request.shares}
		if len(orders) == 1:
			return next(iter(orders)) or request.source
	return None


def analytical_amount(request: Request, row, amount, precision):
	shares = sorted(request.shares, key=lambda share: share.key)
	if not shares or not sum((share.weight for share in shares), ZERO):
		return None
	parts = allocate(amount, [share.weight for share in shares], precision)
	matched = [
		part for share, part in zip(shares, parts, strict=True) if asdict(share.analytic) == row["analytic"]
	]
	return sum(matched, ZERO) if matched else None


def decorate_details(
	result: CellDetailsResponse, filters: Filters, snapshot: Snapshot
) -> CellDetailsResponse:
	"""Add only authorized page references and amounts attributable to this analytic."""
	by_type = defaultdict(set)
	for row in result["rows"]:
		for link in stage_links(row):
			by_type[link.doctype].add(link.name)
	if not by_type:
		return result
	loader = Loader(filters)
	documents = {}
	for doctype, names in by_type.items():
		for batch in chunks(sorted(names)):
			for doc in loader.parents(
				doctype,
				["status", "docstatus"],
				{
					"name": ["in", batch],
					"company": filters.company,
					"docstatus": ["in", [0, 1]],
				},
			):
				documents[Link(doctype, doc.name)] = doc
	orders = [link.name for link in documents if link.doctype == "Payment Order"]
	order_rows = defaultdict(list)
	for child in loader.children(
		"Payment Order Reference",
		"Payment Order",
		orders,
		["payment_request", "reference_doctype", "reference_name", "amount"],
	):
		order_rows[child.parent].append(child)
	requests = {request.source: request for request in snapshot.requests}
	for row in result["rows"]:
		links = stage_links(row)
		mapped_requests = {}
		for link in links:
			request = requests.get(link)
			if link in documents and request:
				reference = request_reference(request, row)
				if (
					reference
					and analytical_amount(request, row, request.total, snapshot.precision) is not None
				):
					mapped_requests[link] = (request, reference)
		stages = []
		for link in links:
			if link not in documents:
				continue
			stage: PaymentStageResponse = {
				"doctype": link.doctype,
				"name": link.name,
				"docstatus": documents[link].get("docstatus", 1),
				"status": documents[link].get("status") or "",
				"currency": snapshot.currency,
				"scope": "analytical_share",
				"non_additive": True,
				"requested": None,
				"ordered": None,
				"executed": None,
				"remaining": None,
				"settled": None,
				"amounts_reason": "ambiguous_allocation",
			}
			if link in mapped_requests:
				request, _reference = mapped_requests[link]
				requested = analytical_amount(request, row, request.total, snapshot.precision)
				remaining = analytical_amount(request, row, request.outstanding, snapshot.precision)
				stage["requested"] = float(requested)
				stage["remaining"] = float(remaining)
				# Settlement can include a journal offset; never label it cash execution.
				# Subtract rounded shares so this reference identity also conserves cents.
				stage["settled"] = float(max(ZERO, requested - remaining))
				stage["amounts_reason"] = ""
			elif link.doctype == "Payment Order":
				matched = []
				for request, reference in mapped_requests.values():
					rows = [
						child
						for child in order_rows[link.name]
						if child.payment_request == request.source.name
						and child.reference_doctype == reference.doctype
						and child.reference_name == reference.name
					]
					if rows and request.rate > ZERO:
						amount = sum((decimal(child.amount) for child in rows), ZERO) * request.rate
						matched.append(analytical_amount(request, row, amount, snapshot.precision))
				if len(matched) == 1 and matched[0] is not None:
					stage["ordered"] = float(matched[0])
					stage["amounts_reason"] = ""
			elif link.doctype in ("Payment Entry", "Journal Entry"):
				stage["scope"] = "component"
				if row["metric"] == "actual" and row["source"] == asdict(link):
					stage["executed"] = row["amount"]
					stage["amounts_reason"] = ""
			stages.append(stage)
		row["payment_stages"] = stages
	return result
