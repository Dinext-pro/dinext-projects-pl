"""Batch ERP adapters for explicitly linked payment instructions."""

from collections import defaultdict
from dataclasses import dataclass, replace
from decimal import Decimal

from .fifo import coverage, warn
from .model import ZERO, Analytic, Link, Obligation, Share, allocate, as_date, decimal, money


@dataclass(frozen=True)
class Instruction:
	source: Link
	key: str
	target: Link | None
	direction: str
	total: Decimal
	remaining: Decimal
	currency: str
	rate: Decimal
	shares: tuple[Share, ...]
	links: tuple[Link, ...] = ()
	claim_total: Decimal | None = None
	claim_remaining: Decimal | None = None


def _shares(source, doc):
	return (
		Share(
			source.name,
			decimal(1),
			Analytic(doc.get("project") or "", doc.get("party_type") or "", doc.get("party") or ""),
		),
	)


def _sum_request_pending(req, parts, invoices):
	covered = sum((p.request_original * req.rate for p in parts), ZERO)
	shared = defaultdict(lambda: ZERO)
	for p in parts:
		shared[p.invoice] += (
			(p.original - p.remaining) * p.request_original / p.original * req.rate if p.original else ZERO
		)
	overlap = sum((min(value, req.paid_by_invoice.get(inv, ZERO)) for inv, value in shared.items()), ZERO)
	standalone = max(ZERO, req.total - covered - max(ZERO, req.total - req.outstanding - overlap))
	return standalone + sum((p.company_remaining for p in parts), ZERO)


def load_instructions(loader):
	snapshot, policy = loader.snapshot, loader.policy
	lookup = {o.source: o for o in (*snapshot.orders, *snapshot.invoices)}
	invoices = {o.source: o for o in snapshot.invoices}
	parts = coverage(snapshot, snapshot.requests, snapshot.invoices)
	snapshot.coverage_parts = parts
	parts_by_request = defaultdict(list)
	for part in parts:
		parts_by_request[part.request].append(part)
	claims = defaultdict(list)
	for req in snapshot.requests:
		lookup[req.source] = Obligation(
			req.source,
			req.direction,
			req.total,
			_sum_request_pending(req, parts_by_request[req.source], invoices)
			if not req.invoice_only
			else min(
				req.outstanding,
				sum((i.company_remaining for i in parts_by_request[req.source]), ZERO),
			),
			req.currency,
			req.rate,
			[],
			req.shares,
		)
		# Full claim positions are retained separately from pending amounts, so a
		# partial PO consumes covered invoice capacity before the uncovered request.
		shares = sorted(req.shares, key=lambda share: share.key)
		grosses = allocate(req.total, [share.weight for share in shares], snapshot.precision)
		paid = allocate(
			max(ZERO, req.total - req.outstanding), [share.weight for share in shares], snapshot.precision
		)
		for share, gross, settled in zip(shares, grosses, paid, strict=True):
			allocations = [p for p in parts_by_request[req.source] if p.request_share == share.key]
			covered = ZERO
			overlap = defaultdict(lambda: ZERO)
			for index, part in enumerate(allocations):
				inv = invoices[part.invoice]
				ishare = next(v for v in inv.shares if v.key == part.invoice_share)
				full = part.request_original * req.rate
				pending = part.company_remaining
				covered += full
				overlap[part.invoice] += (
					(part.original - part.remaining) * part.request_original / part.original * req.rate
					if part.original
					else ZERO
				)
				claims[req.source].append(
					[
						part.invoice,
						part.company_gross,
						pending,
						replace(ishare, key=f"claim:{req.source.name}:{index}:{ishare.key}", weight=pending),
						(req.source, part.invoice),
						inv.currency,
						inv.rate,
						full,
					]
				)
			shared = sum(
				(min(value, req.paid_by_invoice.get(inv, ZERO)) for inv, value in overlap.items()), ZERO
			)
			uncovered = max(ZERO, gross - covered)
			pending = max(ZERO, uncovered - max(ZERO, settled - shared))
			if uncovered and not req.invoice_only:
				claims[req.source].append(
					[
						req.source,
						uncovered,
						pending,
						replace(share, weight=pending),
						(req.source,),
						req.currency,
						req.rate,
						uncovered,
					]
				)
	snapshot.claim_limits = {}
	for obligation in (*snapshot.orders, *snapshot.invoices):
		shares = sorted(obligation.shares, key=lambda share: share.key)
		for share, amount in zip(
			shares,
			allocate(obligation.outstanding, [share.weight for share in shares], snapshot.precision),
			strict=True,
		):
			key = (obligation.source, share.analytic)
			snapshot.claim_limits[key] = snapshot.claim_limits.get(key, ZERO) + amount
	for req in snapshot.requests:
		for target, _gross, pending, share, _aliases, _currency, _rate, _budget in claims[req.source]:
			if target == req.source:
				key = (target, share.analytic)
				snapshot.claim_limits[key] = snapshot.claim_limits.get(key, ZERO) + pending
	# Read expected parents separately: accounting pe_refs continues to contain
	# only submitted entries through today for settlements and GL authorization.
	payment_docs = {dt: dict(loader.docs[dt]) for dt in ("Payment Entry", "Payment Order")}
	pe_fields = "company project party_type party payment_type posting_date paid_from paid_to paid_from_account_currency paid_to_account_currency source_exchange_rate target_exchange_rate paid_amount received_amount base_paid_amount base_received_amount payment_order status".split()
	for dt, fields in (
		("Payment Entry", pe_fields),
		("Payment Order", "company posting_date payment_order_type account".split()),
	):
		if any(p.enabled and p.doctype == dt and 0 in p.docstatuses for p in policy.sources):
			payment_docs[dt].update(
				{
					r.name: r
					for r in loader.parents(
						dt,
						loader.expected_fields(dt, fields),
						{"company": loader.filters.company, "docstatus": 0},
						financial=True,
					)
				}
			)
		if dt == "Payment Entry" and any(
			p.enabled and p.doctype == dt and 1 in p.docstatuses for p in policy.sources
		):
			payment_docs[dt].update(
				{
					r.name: r
					for r in loader.parents(
						dt,
						loader.expected_fields(dt, fields),
						{
							"company": loader.filters.company,
							"docstatus": 1,
							"posting_date": [">", snapshot.today],
						},
						financial=True,
					)
				}
			)
	po_rows = [
		*loader.po_rows,
		*loader.children(
			"Payment Order Reference",
			"Payment Order",
			set(payment_docs["Payment Order"]) - set(loader.docs["Payment Order"]),
			"reference_doctype reference_name payment_request amount".split(),
		),
	]
	missing_entries = {
		row.reference_name for row in po_rows if row.reference_doctype == "Payment Entry"
	} - set(payment_docs["Payment Entry"])
	if missing_entries:
		from .sources import chunks

		for batch in chunks(missing_entries):
			payment_docs["Payment Entry"].update(
				{
					r.name: r
					for r in loader.parents(
						"Payment Entry",
						loader.expected_fields("Payment Entry", pe_fields),
						{
							"company": loader.filters.company,
							"docstatus": ["in", [0, 1]],
							"name": ["in", batch],
						},
						financial=True,
					)
				}
			)
	for dt, documents in payment_docs.items():
		for name, doc in documents.items():
			snapshot.documents[Link(dt, name)] = dict(doc)
	pe_rows = [
		*loader.pe_refs,
		*loader.children(
			"Payment Entry Reference",
			"Payment Entry",
			set(payment_docs["Payment Entry"]) - set(loader.docs["Payment Entry"]),
			"reference_doctype reference_name allocated_amount exchange_rate payment_request payment_term".split(),
		),
	]
	by_pe = defaultdict(list)
	for row in pe_rows:
		by_pe[row.parent].append(row)
	po_by_entry = defaultdict(set)
	for row in po_rows:
		if row.reference_doctype == "Payment Entry" and row.reference_name in payment_docs["Payment Entry"]:
			po_by_entry[row.reference_name].add(Link("Payment Order", row.parent))

	def reference_amount(row, target, entry, receive):
		party_currency = entry.paid_from_account_currency if receive else entry.paid_to_account_currency
		if party_currency not in (snapshot.currency, target.currency):
			warn(snapshot, "Unsupported request settlement currency; forecast is incomplete")
			return ZERO
		rate = decimal(1) if party_currency == snapshot.currency else target.rate
		return abs(decimal(row.allocated_amount)) * rate

	pe_instructions = []
	for name, doc in payment_docs["Payment Entry"].items():
		if doc.payment_type not in ("Pay", "Receive"):
			continue
		source = Link("Payment Entry", name)
		expected = doc.docstatus == 0 or as_date(doc.posting_date) > snapshot.today
		# Current submitted entries are already accounting evidence. They cannot
		# add an expected movement, and only referenced POs need their zero budget.
		if not expected and name not in po_by_entry:
			continue
		receive = doc.payment_type == "Receive"
		amount = abs(decimal(doc.base_received_amount if receive else doc.base_paid_amount))
		rate = decimal(doc.target_exchange_rate if receive else doc.source_exchange_rate)
		currency = doc.paid_to_account_currency if receive else doc.paid_from_account_currency
		if rate <= 0 or not currency:
			warn(snapshot, "Missing exchange rate; forecast is incomplete")
			continue
		pending = amount if expected else ZERO
		if not expected:
			lookup[source] = Obligation(
				source,
				"in" if receive else "out",
				amount,
				ZERO,
				currency,
				rate,
				[],
				list(_shares(source, doc)),
			)
			continue
		links = set(po_by_entry[name])
		if doc.payment_order in payment_docs["Payment Order"]:
			links.add(Link("Payment Order", doc.payment_order))
		shares = []
		first_part = len(pe_instructions)
		reference_rows = by_pe[name]
		party_total = abs(decimal(doc.paid_amount if receive else doc.received_amount))
		weights = [abs(decimal(row.allocated_amount)) for row in reference_rows]
		allocated_native = sum(weights, ZERO)
		if allocated_native > party_total + decimal(1).scaleb(-snapshot.precision):
			warn(snapshot, "Unreconciled payment instruction allocation")
			lookup[source] = Obligation(
				source,
				"in" if receive else "out",
				amount,
				ZERO,
				currency,
				rate,
				[],
				list(_shares(source, doc)),
			)
			claims[source] = []
			continue
		cash_parts = allocate(
			amount, [*weights, max(ZERO, party_total - allocated_native)], snapshot.precision
		)
		for row, cash_amount in zip(reference_rows, cash_parts[:-1], strict=True):
			target_link = Link(row.reference_doctype or "", row.reference_name or "")
			target = lookup.get(target_link)
			if not target:
				if decimal(row.allocated_amount):
					warn(snapshot, "Some financial sources are not accessible; balances are hidden")
				continue
			allocated = reference_amount(row, target, doc, receive)
			if allocated <= 0:
				continue
			claim_pending = min(allocated, target.outstanding)
			cash_pending = money(cash_amount * claim_pending / allocated, snapshot.precision)
			aliases = {*links, target_link}
			if row.payment_request and Link("Payment Request", row.payment_request) in lookup:
				aliases.add(Link("Payment Request", row.payment_request))
			portion_shares = tuple(replace(s, key=f"{row.name}:{s.key}") for s in target.shares)
			weight = sum(s.weight for s in portion_shares)
			shares.extend(replace(s, weight=cash_amount * s.weight / weight) for s in portion_shares)
			pe_instructions.append(
				Instruction(
					source,
					row.name,
					target_link,
					"in" if receive else "out",
					cash_amount,
					cash_pending,
					currency,
					rate,
					portion_shares,
					tuple(sorted(aliases)),
					claim_total=allocated,
					claim_remaining=claim_pending,
				)
			)
		unallocated = cash_parts[-1] if party_total else amount
		if unallocated:
			own_shares = tuple(replace(s, weight=unallocated) for s in _shares(source, doc))
			shares.extend(own_shares)
			pe_instructions.append(
				Instruction(
					source,
					"unallocated",
					None,
					"in" if receive else "out",
					unallocated,
					min(unallocated, pending),
					currency,
					rate,
					own_shares,
					tuple(sorted(links)),
				)
			)
		lookup[source] = Obligation(
			source,
			"in" if receive else "out",
			amount,
			pending,
			currency,
			rate,
			[],
			shares or list(_shares(source, doc)),
		)
		for share, pending_part in zip(
			lookup[source].shares,
			allocate(pending, [share.weight for share in lookup[source].shares], snapshot.precision),
			strict=True,
		):
			key = (source, share.analytic)
			snapshot.claim_limits[key] = snapshot.claim_limits.get(key, ZERO) + pending_part
		if pe_instructions[first_part:]:
			# A PO referencing an entry refines its underlying obligations, even
			# when that entry is not itself an enabled expected source.
			for part in pe_instructions[first_part:]:
				full = allocate(
					part.claim_total if part.claim_total is not None else part.total,
					[share.weight for share in part.shares],
					snapshot.precision,
				)
				pending_parts = allocate(
					part.claim_remaining if part.claim_remaining is not None else part.remaining,
					[share.weight for share in part.shares],
					snapshot.precision,
				)
				budgets = allocate(part.total, [share.weight for share in part.shares], snapshot.precision)
				for share, gross, pending_part, cash_budget in zip(
					part.shares, full, pending_parts, budgets, strict=True
				):
					claims[source].append(
						[
							part.target or source,
							gross,
							pending_part,
							share,
							tuple(dict.fromkeys((source, *part.links))),
							part.currency,
							part.rate,
							cash_budget,
						]
					)

	po_instructions = []
	groups = defaultdict(list)
	for row in po_rows:
		target_link = Link(row.reference_doctype or "", row.reference_name or "")
		request = Link("Payment Request", row.payment_request or "")
		if request in lookup:
			target_link = request
		if target_link not in lookup:
			if decimal(row.amount):
				warn(snapshot, "Some financial sources are not accessible; balances are hidden")
			continue
		target = lookup[target_link]
		rate = lookup[request].rate if request in lookup else target.rate
		amount = abs(decimal(row.amount)) * rate
		links = [target_link, *((request,) if request in lookup else ())]
		groups[(row.parent, target_link)].append((row, target, amount, links))
	for (name, target_link), rows in groups.items():
		target = rows[0][1]
		if target_link in claims:
			positions = [list(part) for part in claims[target_link]]
		else:
			shares = sorted(target.shares, key=lambda share: share.key)
			grosses = allocate(target.total, [share.weight for share in shares], snapshot.precision)
			remaining = allocate(target.outstanding, [share.weight for share in shares], snapshot.precision)
			positions = [
				[target_link, gross, pending, share, (target_link,), target.currency, target.rate, gross]
				for share, gross, pending in zip(shares, grosses, remaining, strict=True)
			]
		for row, target, amount, links in rows:
			budget = amount
			for position_idx, position in enumerate(positions):
				ref, gross, pending, share, aliases, currency, rate, budget_full = position
				if row.reference_doctype in ("Sales Invoice", "Purchase Invoice") and ref != Link(
					row.reference_doctype, row.reference_name
				):
					continue
				spent = min(budget, budget_full)
				if spent <= 0 or gross <= 0:
					continue
				# The row budget belongs to the referenced document's valuation.
				# A covered invoice keeps its own book rate; equal original currency
				# does not imply equal company amounts across different booking dates.
				full = (
					gross
					if spent == budget_full
					else min(gross, money(gross * spent / budget_full, snapshot.precision))
				)
				# Payments consume the first gross positions; one payment cannot
				# reduce every row in a multi-row payment order.
				used_paid = min(full, max(ZERO, gross - pending))
				remaining = max(ZERO, full - used_paid)
				position[1] -= full
				position[2] -= remaining
				position[7] -= spent
				budget -= spent
				if remaining:
					cash_claim = target_link.doctype == "Payment Entry"
					cash_pending = (
						money(spent * remaining / full, snapshot.precision)
						if cash_claim and full
						else remaining
					)
					po_instructions.append(
						Instruction(
							Link("Payment Order", name),
							f"{row.name}:{position_idx}",
							ref,
							target.direction,
							full,
							cash_pending,
							currency,
							rate,
							(replace(share, weight=remaining),),
							tuple(sorted(set((*links, *aliases)))),
							claim_total=full if cash_claim else None,
							claim_remaining=remaining if cash_claim else None,
						)
					)
			if budget > 0:
				warn(snapshot, "Payment instruction exceeds its obligation")
	snapshot.instructions = [*po_instructions, *pe_instructions]
