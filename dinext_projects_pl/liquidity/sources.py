"""ERPNext boundary: permission-aware parent reads, scoped child reads, batch joins.

Child/ledger get_all calls are deliberately bounded by already-authorized parents.
They never expose another document's identifiers or detailed settlement rows.
"""

from collections import defaultdict
from dataclasses import replace
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import get_system_timezone, getdate, today

from .model import (
	ZERO,
	Analytic,
	Filters,
	Flow,
	Link,
	Obligation,
	Request,
	Share,
	Snapshot,
	Stage,
	allocate,
	as_date,
	decimal,
	money,
)

ORDERS = ("Sales Order", "Purchase Order")
INVOICES = ("Sales Invoice", "Purchase Invoice")
FINANCE_ROLES = {
	"System Manager",
	"Accounts Manager",
	"Accounts User",
	"Dinext_Financier",
	"Dinext_Fin_Dir",
	"Z_Dinord_Financier",
}
PROJECT_ROLES = {"Projects Manager", "Project Manager", "Z_Dinord_Project_Manager", "Dinext_Project_Manager"}
FINANCIAL_FIELDS = "company project customer supplier currency conversion_rate party_account_currency base_grand_total base_rounded_total grand_total rounded_total disable_rounded_total outstanding_amount advance_paid due_date posting_date transaction_date status is_return return_against base_paid_amount base_write_off_amount".split()


def chunks(values, size=500):
	values = list(values)
	for i in range(0, len(values), size):
		yield values[i : i + size]


def fields_for(doctype, fields):
	meta = frappe.get_meta(doctype)
	return [
		f
		for f in dict.fromkeys(["name", "owner", *fields])
		if f in ("name", "owner", "parent", "parenttype", "idx", "docstatus", "creation", "modified")
		or meta.has_field(f)
	]


def require_access(company):
	if not isinstance(company, str) or not company.strip():
		frappe.throw(_("Company is required"), frappe.PermissionError)
	roles = set(frappe.get_roles())
	if frappe.session.user == "Guest" or not roles.intersection(FINANCE_ROLES | PROJECT_ROLES):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission("Company", "read", company):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return frappe.session.user == "Administrator" or bool(roles & FINANCE_ROLES)


class Loader:
	def __init__(self, filters: Filters, policy=None):
		self.filters = filters
		self.full_role = require_access(filters.company)
		self.snapshot = Snapshot(
			as_date(today()), frappe.get_cached_value("Company", filters.company, "default_currency")
		)
		self.snapshot.timezone = get_system_timezone()
		self.snapshot.policy = policy
		self.policy = policy
		self.snapshot.precision = int(frappe.db.get_default("currency_precision") or 2)
		self.docs = {}
		self.items = {}
		self.schedules = {}
		self.advances = {}
		self.shares = {}
		self.contracts = defaultdict(list)
		self.outstanding = defaultdict(lambda: ZERO)
		self.ledger_seen = set()
		self.term_paid = defaultdict(lambda: defaultdict(lambda: ZERO))
		self.pe_refs = []
		self.je_rows = []
		self.po_rows = []
		self.payment_orders_by_voucher = defaultdict(set)
		self.requests_by_order_reference = defaultdict(set)
		self.allowed_projects = set()
		self.project_portfolios = {}

	def warn(self, message):
		self.snapshot.complete = False
		if message not in self.snapshot.warnings:
			self.snapshot.warnings.append(message)

	def parents(self, doctype, fields, filters, financial=False):
		if not frappe.has_permission(doctype, "read"):
			if financial:
				self.warn("Some financial sources are not accessible; balances are hidden")
			return []
		rows = frappe.get_list(
			doctype,
			filters=filters,
			fields=fields_for(doctype, fields),
			limit_page_length=0,
			order_by="name asc",
		)
		# get_list already applies roles, owner/share rules, User Permissions and
		# permission_query_conditions. The installed doctype_permission hook simply
		# repeats get_list(name=...) for each row; its predicate was applied above.
		# Retain document-level checks for every other controller policy.
		hooks = frappe.get_hooks("has_permission")
		policies = hooks.get(doctype, []) + hooks.get("*", [])
		query_mirrors = {"doctype_permission.doctype_permission.utils.has_permission"}
		if any(policy not in query_mirrors for policy in policies):
			# A custom policy may inspect any field or child row. Hydrate the already
			# query-authorized documents in batches, never pass a partial document.
			policy_docs = {}
			for batch in chunks(r.name for r in rows):
				for row in frappe.get_all(doctype, filters={"name": ["in", batch]}, fields=["*"]):
					policy_docs[row.name] = frappe.get_doc(dict(row, doctype=doctype))
			for field in frappe.get_meta(doctype).get_table_fields():
				for batch in chunks(policy_docs):
					for child in frappe.get_all(
						field.options,
						filters={
							"parenttype": doctype,
							"parentfield": field.fieldname,
							"parent": ["in", batch],
						},
						fields=["*"],
						order_by="parent asc, idx asc",
					):
						policy_docs[child.parent].append(field.fieldname, child)
			rows = [r for r in rows if frappe.has_permission(doctype, "read", doc=policy_docs[r.name])]
		if financial and self.full_role:
			# Only a completeness boolean leaves this boundary, never hidden counts or identifiers.
			count = frappe.db.count(doctype, filters=filters)
			if count != len(rows):
				self.warn("Some financial sources are not accessible; balances are hidden")
		return rows

	def children(self, doctype, parenttype, parents, fields):
		rows = []
		for batch in chunks(parents):
			rows.extend(
				frappe.get_all(
					doctype,
					filters={"parenttype": parenttype, "parent": ["in", batch]},
					fields=fields_for(doctype, ["parent", "idx", *fields]),
					order_by="parent asc, idx asc",
					limit_page_length=0,
				)
			)
		return rows

	def expected_fields(self, doctype, fields):
		if not self.policy:
			return fields
		configured_dates = {
			name
			for source in self.policy.sources
			if source.enabled and source.doctype == doctype
			for name in (source.date_field, source.fallback)
			if name not in ("payment_schedule", "previous", "undated")
		}
		return list(dict.fromkeys([*fields, "status", "docstatus", "creation", *sorted(configured_dates)]))

	def expected_states(self, doctype):
		return (
			sorted(
				{
					1,
					*(
						state
						for p in self.policy.sources
						if p.doctype == doctype and p.enabled
						for state in p.docstatuses
					),
				}
			)
			if self.policy
			else [1]
		)

	def load(self, *, include_cash=True):
		f = self.filters
		projects = self.parents("Project", ["custom_project_portfolio"], {"company": f.company})
		self.allowed_projects = {p.name for p in projects}
		self.project_portfolios = {p.name: p.get("custom_project_portfolio") for p in projects}
		if set(f.projects) - self.allowed_projects:
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		for dt in ORDERS + INVOICES:
			rows = self.parents(
				dt,
				self.expected_fields(dt, FINANCIAL_FIELDS),
				{"company": f.company, "docstatus": ["in", self.expected_states(dt)]},
				True,
			)
			self.docs[dt] = {r.name: r for r in rows}
			self.items[dt] = self.children(
				dt + " Item",
				dt,
				self.docs[dt],
				[
					"project",
					"sales_order",
					"purchase_order",
					"so_detail",
					"po_detail",
					"base_net_amount",
					"base_amount",
				],
			)
			self.schedules[dt] = self.children(
				"Payment Schedule",
				dt,
				self.docs[dt],
				["payment_term", "due_date", "base_payment_amount", "payment_amount"],
			)
			if dt in INVOICES:
				self.advances[dt] = self.children(
					dt + " Advance",
					dt,
					self.docs[dt],
					["reference_type", "reference_name", "allocated_amount", "exchange_rate"],
				)
		for dt, fields, date_field in (
			(
				"Payment Request",
				"company project party_type party currency party_account_currency grand_total outstanding_amount transaction_date reference_doctype reference_name payment_order payment_request_type status payment_term",
				None,
			),
			(
				"Payment Entry",
				"company project party_type party payment_type posting_date paid_from paid_to paid_from_account_currency paid_to_account_currency source_exchange_rate target_exchange_rate paid_amount received_amount base_paid_amount base_received_amount payment_order",
				"posting_date",
			),
			("Payment Order", "company posting_date payment_order_type account", None),
			("Journal Entry", "company posting_date voucher_type payment_order is_opening", "posting_date"),
		):
			conditions = {
				"company": f.company,
				"docstatus": ["in", self.expected_states(dt)] if dt == "Payment Request" else 1,
			}
			if date_field:
				conditions[date_field] = ["<=", self.snapshot.today]
			rows = self.parents(
				dt,
				self.expected_fields(dt, fields.split()) if dt != "Journal Entry" else fields.split(),
				conditions,
				financial=True,
			)
			self.docs[dt] = {r.name: r for r in rows}
		self.pe_refs = self.children(
			"Payment Entry Reference",
			"Payment Entry",
			self.docs["Payment Entry"],
			"reference_doctype reference_name allocated_amount exchange_rate payment_request payment_term advance_voucher_type advance_voucher_no".split(),
		)
		self.je_rows = self.children(
			"Journal Entry Account",
			"Journal Entry",
			self.docs["Journal Entry"],
			"reference_type reference_name debit credit debit_in_account_currency credit_in_account_currency exchange_rate party_type party project account".split(),
		)
		self.po_rows = self.children(
			"Payment Order Reference",
			"Payment Order",
			self.docs["Payment Order"],
			"reference_doctype reference_name payment_request amount".split(),
		)
		for row in self.po_rows:
			ref = Link(row.reference_doctype or "", row.reference_name or "")
			if row.payment_request in self.docs["Payment Request"]:
				self.requests_by_order_reference[(row.parent, ref)].add(row.payment_request)
			if ref.name in self.docs.get(ref.doctype, {}) and ref.doctype in (
				"Payment Entry",
				"Journal Entry",
			):
				self.payment_orders_by_voucher[ref].add(Link("Payment Order", row.parent))
		self.load_contracts()
		self.load_settlements()
		self.build_obligations()
		self.build_requests()
		self.load_cash(include_movements=include_cash)
		if self.policy:
			from .expected_sources import load_instructions

			self.snapshot.documents = {
				Link(dt, name): dict(doc) for dt, docs in self.docs.items() for name, doc in docs.items()
			}
			load_instructions(self)
		self.snapshot.can_balance = (
			include_cash and self.full_role and self.snapshot.complete and not f.analytical
		)
		return self.snapshot

	def load_contracts(self):
		# Contract uses an explicit reverse document link, not a party/project guess.
		if not frappe.has_permission("Contract", "read"):
			return
		for dt in (*ORDERS, *INVOICES, "Payment Request", "Payment Entry"):
			for batch in chunks(self.docs[dt]):
				for row in self.parents(
					"Contract",
					["document_type", "document_name"],
					{"document_type": dt, "document_name": ["in", batch]},
				):
					self.contracts[Link(dt, row.document_name)].append(row.name)

	def contract(self, link):
		values = self.contracts.get(link, [])
		if len(values) > 1:
			self.warn("Multiple contracts require an explicit allocation")
		return values[0] if len(values) == 1 else ""

	def load_settlements(self):
		# The debt itself belongs to an authorized invoice. Settlement details remain private.
		for dt in INVOICES:
			for batch in chunks(self.docs[dt]):
				rows = frappe.get_all(
					"Payment Ledger Entry",
					filters={
						"company": self.filters.company,
						"against_voucher_type": dt,
						"against_voucher_no": ["in", batch],
						"delinked": 0,
						"posting_date": ["<=", self.snapshot.today],
					},
					fields=["against_voucher_no", "sum(amount_in_account_currency) as outstanding"],
					group_by="against_voucher_no",
					order_by="against_voucher_no",
					limit_page_length=0,
				)
				for row in rows:
					link = Link(dt, row.against_voucher_no)
					self.ledger_seen.add(link)
					self.outstanding[link] += decimal(row.outstanding)
			# Retain a future submitted invoice's own debt, never a future payment
			# or another invoice's credit. Grouping preserves zero settled balances.
			future = [
				name
				for name, doc in self.docs[dt].items()
				if doc.get("docstatus", 1) == 1
				and as_date(doc.get("posting_date"))
				and as_date(doc.posting_date) > self.snapshot.today
			]
			for batch in chunks(future):
				for row in frappe.get_all(
					"Payment Ledger Entry",
					filters={
						"company": self.filters.company,
						"against_voucher_type": dt,
						"against_voucher_no": ["in", batch],
						"voucher_type": dt,
						"posting_date": [">", self.snapshot.today],
						"delinked": 0,
					},
					fields=[
						"against_voucher_no",
						"voucher_no",
						"sum(amount_in_account_currency) as outstanding",
					],
					group_by="against_voucher_no, voucher_no",
					order_by="against_voucher_no, voucher_no",
					limit_page_length=0,
				):
					if row.voucher_no == row.against_voucher_no:
						link = Link(dt, row.against_voucher_no)
						self.ledger_seen.add(link)
						self.outstanding[link] += decimal(row.outstanding)
		for row in self.pe_refs:
			link = Link(row.reference_doctype or "", row.reference_name or "")
			if link.name in self.docs.get(link.doctype, {}) and row.payment_term:
				self.term_paid[link][row.payment_term] += decimal(row.allocated_amount) * self.account_rate(
					link
				)

	def account_rate(self, link):
		doc = self.docs.get(link.doctype, {}).get(link.name)
		if not doc:
			return ZERO
		return (
			Decimal(1)
			if doc.get("party_account_currency") == self.snapshot.currency
			else decimal(doc.get("conversion_rate"))
		)

	def document_shares(self, dt, doc, items):
		link = Link(dt, doc.name)
		party_type = "Customer" if dt.startswith("Sales") else "Supplier"
		party = doc.get("customer" if party_type == "Customer" else "supplier") or ""
		result = []
		for row in items or [frappe._dict(name="document", project=doc.get("project"), base_net_amount=1)]:
			order_name = row.get("sales_order") or row.get("purchase_order")
			order_type = "Sales Order" if dt.startswith("Sales") else "Purchase Order"
			order = (
				link
				if dt in ORDERS
				else Link(order_type, order_name)
				if order_name in self.docs.get(order_type, {})
				else None
			)
			analytic = Analytic(
				row.get("project") or doc.get("project") or "",
				party_type,
				party,
				self.contract(order) or self.contract(link),
				order,
				link if dt in INVOICES else None,
			)
			result.append(
				Share(row.name, abs(decimal(row.get("base_net_amount") or row.get("base_amount"))), analytic)
			)
		if not sum((r.weight for r in result), ZERO):
			result = [replace(r, weight=Decimal(1)) for r in result]
		self.shares[link] = result
		return result

	def build_obligations(self):
		settled_orders = defaultdict(lambda: ZERO)
		billed_orders = defaultdict(lambda: ZERO)
		for dt in INVOICES + ORDERS:
			items = defaultdict(list)
			schedules = defaultdict(list)
			for row in self.items[dt]:
				items[row.parent].append(row)
			for row in self.schedules[dt]:
				schedules[row.parent].append(row)
			for doc in self.docs[dt].values():
				link = Link(dt, doc.name)
				rate = decimal(doc.conversion_rate)
				if rate <= 0:
					self.warn("Missing exchange rate; forecast is incomplete")
					continue
				total = decimal(
					doc.base_grand_total
					if doc.get("disable_rounded_total")
					else doc.get("base_rounded_total") or doc.base_grand_total
				)
				shares = self.document_shares(dt, doc, items[doc.name])
				if dt in INVOICES:
					if doc.get("docstatus", 1) == 0:
						outstanding = total
					elif link not in self.ledger_seen:
						# Legacy invoices without ledger rows need explicit diagnostics, never fake reconciliation.
						self.warn("Invoice payment ledger is incomplete")
						outstanding = decimal(doc.outstanding_amount) * self.account_rate(link)
					else:
						outstanding = self.outstanding[link] * self.account_rate(link)
					parts = allocate(total, [s.weight for s in shares], self.snapshot.precision)
					paid_parts = allocate(
						total - outstanding, [s.weight for s in shares], self.snapshot.precision
					)
					for share, gross, paid in zip(shares, parts, paid_parts, strict=True):
						if share.analytic.order:
							order = self.docs[share.analytic.order.doctype][share.analytic.order.name]
							factor = (
								decimal(order.conversion_rate) / rate
								if order.currency == doc.currency
								else Decimal(1)
							)
							billed_orders[share.analytic.order] += gross * factor
							settled_orders[share.analytic.order] += paid * factor
				else:
					outstanding = total - settled_orders[link]
					if doc.status == "Closed":
						outstanding = billed_orders[link] - settled_orders[link]
				# Credit notes with their own outstanding balance represent refunds. A return
				# allocated against the original invoice already reduced that invoice's PLE.
				refund = dt in INVOICES and bool(doc.get("is_return")) and outstanding < 0
				direction = "in" if dt.startswith("Sales") else "out"
				if refund:
					direction = "out" if direction == "in" else "in"
				stages = [
					Stage(
						str(r.idx).zfill(5) + ":" + r.name,
						as_date(r.due_date),
						abs(decimal(r.base_payment_amount or decimal(r.payment_amount) * rate)),
						r.payment_term or "",
					)
					for r in schedules[doc.name]
				]
				if not stages:
					stages = [Stage("document", as_date(doc.get("due_date")), abs(total))]
				obligation = Obligation(
					link,
					direction,
					abs(total),
					abs(outstanding) if refund else max(ZERO, outstanding),
					doc.currency,
					rate,
					stages,
					shares,
					dict(self.term_paid[link]),
				)
				(self.snapshot.invoices if dt in INVOICES else self.snapshot.orders).append(obligation)
		self.apply_order_advances()

	def apply_order_advances(self):
		by_link = {o.source: o for o in self.snapshot.orders}
		consumed = defaultdict(lambda: ZERO)
		for invoice_type, rows in self.advances.items():
			for row in rows:
				invoice = Link(invoice_type, row.parent)
				shares = self.shares.get(invoice, [])
				amount = decimal(row.allocated_amount) * self.account_rate(invoice)
				for share, part in zip(
					shares, allocate(amount, [s.weight for s in shares], self.snapshot.precision), strict=True
				):
					if share.analytic.order:
						consumed[(share.analytic.order, row.reference_type, row.reference_name)] += part
		for dt in ORDERS:
			for batch in chunks(self.docs[dt]):
				rows = frappe.get_all(
					"Advance Payment Ledger Entry",
					filters={
						"company": self.filters.company,
						"against_voucher_type": dt,
						"against_voucher_no": ["in", batch],
						"delinked": 0,
					},
					fields=["against_voucher_no", "voucher_type", "voucher_no", "amount", "currency"],
					limit_page_length=0,
				)
				amounts = defaultdict(lambda: ZERO)
				for row in rows:
					link = Link(dt, row.against_voucher_no)
					if row.voucher_no not in self.docs.get(row.voucher_type, {}):
						self.warn("Advance settlement sources are incomplete")
						continue
					rate = Decimal(1) if row.currency == self.snapshot.currency else self.account_rate(link)
					amounts[(link, row.voucher_type, row.voucher_no)] += decimal(row.amount) * rate
				for key, amount in amounts.items():
					link = key[0]
					if link in by_link:
						# ERPNext retains the order's original advance attribution after
						# allocation to an invoice. That allocated part already reduced
						# the order through invoice settlement above.
						remaining = max(ZERO, abs(amount) - consumed[key])
						by_link[link].outstanding = max(ZERO, by_link[link].outstanding - remaining)

	def request_rate(self, doc, reference):
		if doc.currency == self.snapshot.currency:
			return Decimal(1)
		ref = self.docs.get(reference.doctype, {}).get(reference.name)
		if ref and ref.get("currency") == doc.currency and (not self.policy or reference.doctype in INVOICES):
			return decimal(ref.conversion_rate)
		if not doc.transaction_date:
			return ZERO
		# Batch-loaded local ERPNext rates: no network fallback or per-request remote lookup.
		pairs = [(doc.currency, self.snapshot.currency), (self.snapshot.currency, doc.currency)]
		for source, target in pairs:
			matches = [
				r
				for r in self.exchange_rates
				if r.from_currency == source
				and r.to_currency == target
				and as_date(r.date) <= as_date(doc.transaction_date)
			]
			if matches:
				rate = decimal(max(matches, key=lambda r: (r.date, r.name)).exchange_rate)
				if rate > 0:
					return rate if source == doc.currency else Decimal(1) / rate
		return ZERO

	def request_settlement(self, request_name, amount, party_currency, reference):
		"""Value a shared settlement once in the request's own monetary basis."""
		doc = self.docs["Payment Request"][request_name]
		rate = self.request_rates[request_name]
		if rate <= 0:
			return ZERO
		amount = abs(decimal(amount))
		if party_currency == doc.currency:
			return amount * rate
		ref = self.docs.get(reference.doctype, {}).get(reference.name)
		if ref and ref.get("currency") == doc.currency and decimal(ref.get("conversion_rate")) > 0:
			if party_currency == self.snapshot.currency:
				return amount / decimal(ref.conversion_rate) * rate
		if party_currency == self.snapshot.currency:
			return amount
		if (
			ref
			and ref.get("party_account_currency") == party_currency
			and ref.get("currency") == party_currency
		):
			return amount * decimal(ref.conversion_rate)
		self.warn("Unsupported request settlement currency; forecast is incomplete")
		return ZERO

	def build_requests(self):
		self.exchange_rates = self.parents(
			"Currency Exchange", ["from_currency", "to_currency", "date", "exchange_rate"], {}
		)
		self.request_rates = {
			doc.name: self.request_rate(doc, Link(doc.reference_doctype or "", doc.reference_name or ""))
			for doc in self.docs["Payment Request"].values()
		}
		paid = defaultdict(lambda: ZERO)
		paid_by_reference = defaultdict(lambda: defaultdict(lambda: ZERO))
		ordered_coverage = defaultdict(lambda: defaultdict(lambda: ZERO))
		links = defaultdict(set)
		for row in self.pe_refs:
			if row.payment_request in self.docs["Payment Request"]:
				pe = self.docs["Payment Entry"][row.parent]
				rate = decimal(
					pe.source_exchange_rate if pe.payment_type == "Receive" else pe.target_exchange_rate
				)
				value = (
					self.request_settlement(
						row.payment_request,
						row.allocated_amount,
						pe.paid_from_account_currency
						if pe.payment_type == "Receive"
						else pe.paid_to_account_currency,
						Link(row.reference_doctype or "", row.reference_name or ""),
					)
					if self.policy
					else decimal(row.allocated_amount) * rate
				)
				paid[row.payment_request] += value
				paid_by_reference[row.payment_request][
					Link(row.reference_doctype or "", row.reference_name or "")
				] += value
				links[row.payment_request].add(Link("Payment Entry", row.parent))
				links[row.payment_request].update(
					self.payment_orders_by_voucher[Link("Payment Entry", row.parent)]
				)
		po_by_name = defaultdict(list)
		for row in self.po_rows:
			if row.payment_request in self.docs["Payment Request"]:
				po_by_name[row.parent].append(row)
				links[row.payment_request].add(Link("Payment Order", row.parent))
				if row.reference_doctype in INVOICES:
					ordered_coverage[row.payment_request][
						Link(row.reference_doctype, row.reference_name)
					] += decimal(row.amount)
		# ERPNext reconciliation replaces an order reference with an invoice row and
		# retains advance_voucher_* but does not copy payment_request. Recover only
		# when an explicit PO allocation uniquely joins that original order and invoice.
		advance_requests = defaultdict(set)
		for request_name, coverage in ordered_coverage.items():
			request = self.docs["Payment Request"][request_name]
			for invoice in coverage:
				advance_requests[(request.reference_doctype, request.reference_name, invoice)].add(
					request_name
				)
		for row in self.pe_refs:
			if row.payment_request or not row.advance_voucher_no:
				continue
			invoice = Link(row.reference_doctype or "", row.reference_name or "")
			matches = advance_requests[(row.advance_voucher_type, row.advance_voucher_no, invoice)]
			if len(matches) == 1:
				request_name = next(iter(matches))
				pe = self.docs["Payment Entry"][row.parent]
				rate = decimal(
					pe.source_exchange_rate if pe.payment_type == "Receive" else pe.target_exchange_rate
				)
				amount = (
					self.request_settlement(
						request_name,
						row.allocated_amount,
						pe.paid_from_account_currency
						if pe.payment_type == "Receive"
						else pe.paid_to_account_currency,
						invoice,
					)
					if self.policy
					else decimal(row.allocated_amount) * rate
				)
				paid[request_name] += amount
				paid_by_reference[request_name][invoice] += amount
				links[request_name].add(Link("Payment Entry", row.parent))
			elif matches:
				self.warn("Unreconciled request coverage")
		# A JE's explicit payment_order plus reference rows identifies the request being settled.
		for row in self.je_rows:
			je = self.docs["Journal Entry"][row.parent]
			matches = [
				r
				for r in po_by_name.get(je.payment_order, [])
				if r.reference_doctype == row.reference_type and r.reference_name == row.reference_name
			]
			if len(matches) == 1:
				request_name = matches[0].payment_request
				currency = (
					self.docs["Payment Request"][request_name].party_account_currency
					or self.snapshot.currency
				)
				amount = (
					self.request_settlement(
						request_name,
						abs(decimal(row.debit_in_account_currency) - decimal(row.credit_in_account_currency)),
						currency,
						Link(row.reference_type, row.reference_name),
					)
					if self.policy
					else abs(decimal(row.debit) - decimal(row.credit))
				)
				paid[request_name] += amount
				paid_by_reference[request_name][Link(row.reference_type, row.reference_name)] += amount
				links[matches[0].payment_request].add(Link("Journal Entry", row.parent))
			elif len(matches) > 1:
				self.warn("Payment order execution requires an explicit allocation")
		invoice_map = {i.source: i for i in self.snapshot.invoices}
		for doc in self.docs["Payment Request"].values():
			if doc.status in ("Draft", "Cancelled", "Failed") and not (
				self.policy
				and any(p.doctype == "Payment Request" and p.accepts(doc) for p in self.policy.sources)
			):
				continue
			ref = Link(doc.reference_doctype or "", doc.reference_name or "")
			rate = self.request_rates[doc.name]
			if rate <= 0:
				self.warn("Missing exchange rate; forecast is incomplete")
				continue
			total = decimal(doc.grand_total) * rate
			outstanding = max(ZERO, total - paid[doc.name])
			# Status Paid is not evidence of a cash movement. A ledger-backed settlement wins.
			stored_rate = Decimal(1) if doc.party_account_currency == self.snapshot.currency else rate
			stored = (
				self.request_settlement(
					doc.name, doc.outstanding_amount, doc.party_account_currency or doc.currency, ref
				)
				if self.policy
				else decimal(doc.outstanding_amount) * stored_rate
			)
			if doc.get("docstatus", 1) == 1 and outstanding - stored > Decimal(1).scaleb(
				-self.snapshot.precision
			):
				self.warn("Payment request outstanding differs from linked settlements")
			cov = {}
			invoice_only = ref.doctype in INVOICES
			if invoice_only:
				if ref not in invoice_map:
					self.warn("Some financial sources are not accessible; balances are hidden")
					continue
				cov[ref] = min(outstanding, invoice_map[ref].outstanding)
			else:
				# A submitted Payment Order row explicitly supplies request, invoice and
				# amount. The standard ERPNext mapper stores this amount in PR currency.
				for invoice, covered in ordered_coverage[doc.name].items():
					if invoice not in invoice_map:
						self.warn("Some financial sources are not accessible; balances are hidden")
						continue
					remaining = max(ZERO, covered * rate - paid_by_reference[doc.name][invoice])
					cov[invoice] = min(remaining, invoice_map[invoice].outstanding)
				if sum(cov.values(), ZERO) > outstanding:
					self.warn("Unreconciled request coverage")
					cov = {}
			shares = self.shares.get(ref)
			if not shares:
				shares = [
					Share(
						"request",
						Decimal(1),
						Analytic(
							doc.project or "",
							doc.party_type or "",
							doc.party or "",
							self.contract(Link("Payment Request", doc.name)),
						),
					)
				]
			if (
				not self.policy
				and ref.doctype in ORDERS
				and any(s.analytic.order == ref for i in self.snapshot.invoices for s in i.shares)
				and not invoice_only
				and not cov
			):
				self.warn("Order request and invoice overlap requires an explicit allocation")
			self.snapshot.requests.append(
				Request(
					Link("Payment Request", doc.name),
					"in" if doc.payment_request_type == "Inward" else "out",
					outstanding,
					total,
					doc.currency,
					rate,
					as_date(doc.transaction_date),
					shares,
					cov,
					invoice_only,
					tuple(sorted(links[doc.name])),
					doc.status,
					doc.get("payment_term") or "",
					{ref: min(total, invoice_map[ref].total)}
					if invoice_only
					else {i: a * rate for i, a in ordered_coverage[doc.name].items() if i in invoice_map},
					dict(paid_by_reference[doc.name]),
				)
			)

	def allowed_analytic(self, a):
		f = self.filters
		if a.project and a.project not in self.allowed_projects:
			return False
		if not self.full_role and not a.project:
			return False
		return (
			(not f.projects or a.project in f.projects)
			and (not f.portfolios or self.project_portfolios.get(a.project) in f.portfolios)
			and (not f.party_type or a.party_type == f.party_type)
			and (not f.parties or a.party in f.parties)
		)

	def load_cash(self, *, include_movements=True):
		f = self.filters
		accounts = self.parents(
			"Account",
			["account_currency"],
			{"company": f.company, "account_type": ["in", ["Bank", "Cash"]], "is_group": 0},
			True,
		)
		account_names = {a.name for a in accounts}
		if set(f.accounts) - account_names:
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		if not accounts or not include_movements:
			return
		conditions = {
			"company": f.company,
			"account": ["in", sorted(account_names)],
			"is_cancelled": 0,
			"posting_date": ["<=", self.snapshot.today],
		}
		rows = self.parents(
			"GL Entry",
			"posting_date account debit credit debit_in_account_currency credit_in_account_currency account_currency voucher_type voucher_no project party_type party is_opening".split(),
			conditions,
			True,
		)
		by_voucher = defaultdict(list)
		for row in rows:
			value = decimal(row.debit) - decimal(row.credit)
			day = as_date(row.posting_date)
			if not f.accounts or row.account in f.accounts:
				self.snapshot.current_cash += value
				if day < f.from_date:
					self.snapshot.opening += value
				else:
					self.snapshot.cash_daily[day] = self.snapshot.cash_daily.get(day, ZERO) + value
			# The opening balance also depends on historical cash sources. Authorize
			# their parents before declaring a company-wide balance complete.
			by_voucher[Link(row.voucher_type, row.voucher_no)].append(row)
		# Cash GL can also originate in installed apps (POS, expenses, loans, ...).
		# Authorize such parents in batches instead of silently dropping their cash.
		extra_vouchers = defaultdict(set)
		for voucher in by_voucher:
			if voucher.doctype not in self.docs:
				extra_vouchers[voucher.doctype].add(voucher.name)
		for doctype, names in extra_vouchers.items():
			self.docs[doctype] = {}
			if not frappe.db.exists("DocType", doctype):
				self.warn("Some cash source documents are not accessible")
				continue
			meta = frappe.get_meta(doctype)
			for batch in chunks(names):
				filters = {"name": ["in", batch]}
				if meta.has_field("company"):
					filters["company"] = f.company
				if meta.is_submittable:
					filters["docstatus"] = 1
				parents = self.parents(
					doctype,
					["project", "party_type", "party", "customer", "supplier", "voucher_type", "is_opening"],
					filters,
					True,
				)
				self.docs[doctype].update({p.name: p for p in parents})
		pe_rows = defaultdict(list)
		je_rows = defaultdict(list)
		for row in self.pe_refs:
			pe_rows[row.parent].append(row)
		for row in self.je_rows:
			je_rows[row.parent].append(row)
		for voucher, entries in by_voucher.items():
			doc = self.docs.get(voucher.doctype, {}).get(voucher.name)
			if not doc:
				self.warn("Some cash source documents are not accessible")
				continue
			if not f.from_date <= as_date(entries[0].posting_date) <= f.to_date:
				continue
			adjustment = doc.get("voucher_type") in (
				"Exchange Rate Revaluation",
				"Exchange Gain Or Loss",
				"Opening Entry",
				"Depreciation Entry",
				"Deferred Revenue",
				"Deferred Expense",
			) or any(r.is_opening == "Yes" for r in entries)
			incoming = sum((max(ZERO, decimal(r.debit) - decimal(r.credit)) for r in entries), ZERO)
			outgoing = sum((max(ZERO, decimal(r.credit) - decimal(r.debit)) for r in entries), ZERO)
			transfer = ZERO
			if not adjustment and doc.get("payment_type") == "Internal Transfer":
				transfer = min(incoming, outgoing)
			elif not adjustment and voucher.doctype == "Journal Entry":
				# A journal can mix an own-account transfer and a supplier payment.
				# Reserve party-facing cash first; only the remaining paired bank legs
				# are internal. Simultaneous customer/supplier cash is not netted away.
				party_in = sum(
					(
						max(ZERO, decimal(r.credit) - decimal(r.debit))
						for r in je_rows[voucher.name]
						if r.party
					),
					ZERO,
				)
				party_out = sum(
					(
						max(ZERO, decimal(r.debit) - decimal(r.credit))
						for r in je_rows[voucher.name]
						if r.party
					),
					ZERO,
				)
				transfer = min(max(ZERO, incoming - party_in), max(ZERO, outgoing - party_out))
			remaining_transfer = {"in": transfer, "out": transfer}
			remaining_shares = {}
			selected = set(f.accounts) if f.accounts else account_names
			partial = bool(f.accounts) and any(r.account not in selected for r in entries)
			for row in sorted(entries, key=lambda r: r.name):
				value = decimal(row.debit) - decimal(row.credit)
				direction = "in" if value >= 0 else "out"
				internal = min(abs(value), remaining_transfer[direction])
				remaining_transfer[direction] -= internal
				for metric, amount in (
					("adjustment" if adjustment else "actual", abs(value) - internal),
					("transfer", internal if partial else ZERO),
				):
					if not amount:
						continue
					gross = (
						(incoming if direction == "in" else outgoing) - transfer
						if metric != "transfer"
						else transfer
					)
					references = (
						pe_rows[voucher.name] if voucher.doctype == "Payment Entry" else je_rows[voucher.name]
					)
					parts = self.cash_shares(
						voucher,
						doc,
						row,
						references if metric != "transfer" else [],
						gross=gross,
					)
					# Allocate the voucher once, then consume its budget across bank
					# legs. Rounding and selected-account slices stay consistent.
					key = (metric, direction)
					if key not in remaining_shares:
						remaining_shares[key] = allocate(
							gross, [s.weight for s, _ in parts], self.snapshot.precision
						)
					amounts = allocate(amount, remaining_shares[key], self.snapshot.precision)
					remaining_shares[key] = [
						weight - part for weight, part in zip(remaining_shares[key], amounts, strict=True)
					]
					for (share, refs), part in zip(parts, amounts, strict=True):
						if not part or not refs or row.account not in selected:
							continue
						self.snapshot.actual.append(
							Flow(
								f"gl:{row.name}:{metric}:{share.key}",
								metric,
								direction,
								part,
								as_date(row.posting_date),
								as_date(row.posting_date),
								voucher,
								share.analytic,
								row.account_currency or self.snapshot.currency,
								(
									abs(
										decimal(row.debit_in_account_currency)
										- decimal(row.credit_in_account_currency)
									)
									* part
									/ abs(value)
								)
								if value
								else ZERO,
								paid=part if metric == "actual" else ZERO,
								payment=voucher,
								links=refs,
								account=row.account,
							)
						)

	def cash_shares(self, voucher, doc, gl_row, reference_rows, gross):
		if voucher in self.shares:
			return [(s, (voucher,)) for s in self.shares[voucher]]
		parts = []
		for row in reference_rows:
			if voucher.doctype == "Journal Entry":
				cash_value = decimal(gl_row.debit) - decimal(gl_row.credit)
				party_value = decimal(row.get("debit")) - decimal(row.get("credit"))
				if cash_value * party_value >= 0:
					continue
			ref = Link(
				row.get("reference_doctype") or row.get("reference_type") or "",
				row.get("reference_name") or "",
			)
			rate = decimal(
				doc.get("source_exchange_rate")
				if doc.get("payment_type") == "Receive"
				else doc.get("target_exchange_rate")
			)
			if voucher.doctype == "Payment Entry" and decimal(row.get("allocated_amount")) and rate <= 0:
				self.warn("Missing exchange rate; forecast is incomplete")
				# The reference cannot be valued safely. Reserve the whole movement
				# privately instead of assigning it to an unrelated visible invoice.
				return [(Share("withheld", gross, Analytic()), ())]
			base = (
				abs(decimal(row.get("allocated_amount")) * rate)
				if voucher.doctype == "Payment Entry"
				else abs(decimal(row.get("debit")) - decimal(row.get("credit")))
			)
			if not base or not ref.doctype or not ref.name:
				continue
			if ref not in self.shares:
				self.warn("Some cash source documents are not accessible")
				# Keep the denominator but never emit this identifier or amount.
				parts.append((Share("withheld", base, Analytic()), ()))
				continue
			refs = [voucher, ref]
			refs.extend(sorted(self.payment_orders_by_voucher[voucher]))
			request = row.get("payment_request")
			if request in self.docs["Payment Request"]:
				refs.append(Link("Payment Request", request))
			if doc.get("payment_order") in self.docs["Payment Order"]:
				refs.append(Link("Payment Order", doc.payment_order))
				matched = self.requests_by_order_reference[(doc.payment_order, ref)]
				if len(matched) == 1:
					refs.append(Link("Payment Request", next(iter(matched))))
			weights = [s.weight for s in self.shares[ref]]
			for share, part in zip(
				self.shares[ref], allocate(base, weights, self.snapshot.precision), strict=True
			):
				parts.append((replace(share, key=row.name + ":" + share.key, weight=part), tuple(refs)))
		# The basis is the whole voucher direction, not one bank leg or PE-only
		# fields. Fees and unallocated cash retain their own analytic component.
		unallocated = max(ZERO, gross - sum((s.weight for s, _ in parts), ZERO))
		if unallocated:
			analytic = Analytic(
				gl_row.project or doc.get("project") or "",
				gl_row.party_type
				or doc.get("party_type")
				or ("Customer" if doc.get("customer") else "Supplier" if doc.get("supplier") else ""),
				gl_row.party or doc.get("party") or doc.get("customer") or doc.get("supplier") or "",
			)
			parts.append(
				(
					Share("unallocated", unallocated, analytic),
					(voucher, *sorted(self.payment_orders_by_voucher[voucher])),
				)
			)
		return parts


def load(filters, *, include_cash=True):
	from .settings import load_policy

	require_access(filters.company)
	loader = Loader(filters, load_policy())
	snapshot = loader.load(include_cash=include_cash)
	return loader, snapshot
