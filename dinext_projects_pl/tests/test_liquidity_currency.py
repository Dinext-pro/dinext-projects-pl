"""Request valuation is independent of a later payment's exchange rate."""

import unittest
from datetime import date
from decimal import Decimal as D
from types import SimpleNamespace

import frappe

from dinext_projects_pl.liquidity.model import Link, Snapshot
from dinext_projects_pl.liquidity.sources import Loader


class TestRequestCurrency(unittest.TestCase):
	def setUp(self):
		self.loader = Loader.__new__(Loader)
		self.loader.snapshot = Snapshot(date(2026, 10, 30), "USD")
		self.loader.policy = object()
		self.request = frappe._dict(
			name="REQ",
			currency="EUR",
			transaction_date="2026-10-30",
			reference_doctype="Sales Order",
			reference_name="ORDER",
		)
		self.loader.docs = {
			"Sales Order": {
				"ORDER": frappe._dict(currency="EUR", conversion_rate=3, party_account_currency="USD")
			},
			"Sales Invoice": {
				"INV": frappe._dict(currency="EUR", conversion_rate=4, party_account_currency="USD")
			},
			"Payment Request": {"REQ": self.request},
		}
		self.loader.exchange_rates = [
			frappe._dict(
				name="RATE", from_currency="EUR", to_currency="USD", date="2026-10-29", exchange_rate=2
			)
		]
		self.loader.request_rates = {"REQ": D(2)}

	def test_standalone_request_uses_its_date_rate_and_invoice_coverage_uses_invoice_basis(self):
		self.assertEqual(self.loader.request_rate(self.request, Link("Sales Order", "ORDER")), 2)
		self.assertEqual(self.loader.request_rate(self.request, Link("Sales Invoice", "INV")), 4)

	def test_same_original_currency_payment_uses_request_valuation(self):
		self.assertEqual(self.loader.request_settlement("REQ", 20, "EUR", Link("Sales Invoice", "INV")), 40)

	def test_company_account_payment_recovers_original_units_from_actual_reference(self):
		self.assertEqual(self.loader.request_settlement("REQ", 80, "USD", Link("Sales Invoice", "INV")), 40)
		self.assertEqual(self.loader.request_settlement("REQ", 60, "USD", Link("Sales Order", "ORDER")), 40)

	def test_unsupported_third_currency_is_diagnostic(self):
		self.assertEqual(self.loader.request_settlement("REQ", 20, "GBP", Link("Sales Invoice", "INV")), 0)
		self.assertFalse(self.loader.snapshot.complete)

	def test_full_request_order_refines_covered_invoice_at_its_own_book_rate(self):
		from dinext_projects_pl.liquidity.calculation import calculate
		from dinext_projects_pl.liquidity.expected_sources import load_instructions
		from dinext_projects_pl.tests.test_liquidity_projection import invoice, request, snapshot

		inv = invoice(total=240, outstanding=160)
		inv.currency, inv.rate = "EUR", D(4)
		req = request(total=200)
		req.currency, req.rate, req.outstanding = "EUR", D(2), D(200)
		s = snapshot(invoices=[inv], requests=[req])
		s.documents[inv.source].update(currency="EUR", grand_total=60, outstanding_amount=40)
		s.documents[req.source].update(currency="EUR", grand_total=100)
		po = frappe._dict(name="PO", docstatus=1, posting_date=s.today)
		loader = SimpleNamespace(
			snapshot=s,
			policy=s.policy,
			filters=SimpleNamespace(company="Demo"),
			docs={"Payment Entry": {}, "Payment Order": {"PO": po}},
			pe_refs=[],
			po_rows=[
				frappe._dict(
					name=str(i),
					parent="PO",
					reference_doctype="Sales Order",
					reference_name="ORDER",
					payment_request=req.source.name,
					amount=50,
				)
				for i in range(2)
			],
			expected_fields=lambda _dt, fields: fields,
			parents=lambda *_args, **_kwargs: [],
			children=lambda *_args, **_kwargs: [],
		)
		for rows, refined in ((loader.po_rows[:1], 120), (loader.po_rows, 240)):
			with self.subTest(order_rows=len(rows)):
				loader.po_rows = rows
				load_instructions(loader)
				flows = [f for f in calculate(s) if f.metric == "forecast"]
				self.assertEqual(sum(f.amount for f in flows), 240)
				self.assertEqual(
					sum(f.amount for f in flows if f.payment == Link("Payment Order", "PO")), refined
				)

	def test_draft_entry_uses_cash_rate_while_consuming_invoice_book_debt(self):
		from dinext_projects_pl.liquidity.calculation import calculate
		from dinext_projects_pl.liquidity.expected_sources import load_instructions
		from dinext_projects_pl.tests.test_liquidity_projection import invoice, snapshot

		inv = invoice(total=240, outstanding=160)
		inv.currency, inv.rate = "EUR", D(4)
		s = snapshot(invoices=[inv])
		s.documents[inv.source].update(currency="EUR", grand_total=60, party_account_currency="EUR")
		entry = frappe._dict(
			name="PE",
			docstatus=0,
			payment_type="Receive",
			posting_date=s.today,
			paid_from_account_currency="EUR",
			paid_to_account_currency="USD",
			source_exchange_rate=3,
			target_exchange_rate=1,
			paid_amount=40,
			received_amount=120,
			base_paid_amount=120,
			base_received_amount=120,
		)
		row = frappe._dict(
			name="REF",
			parent="PE",
			reference_doctype=inv.source.doctype,
			reference_name=inv.source.name,
			allocated_amount=40,
		)
		loader = SimpleNamespace(
			snapshot=s,
			policy=s.policy,
			filters=SimpleNamespace(company="Demo"),
			docs={"Payment Entry": {}, "Payment Order": {}},
			pe_refs=[],
			po_rows=[],
			expected_fields=lambda _dt, fields: fields,
			parents=lambda dt, *_args, **_kwargs: [entry] if dt == "Payment Entry" else [],
			children=lambda dt, *_args, **_kwargs: [row] if dt == "Payment Entry Reference" else [],
		)
		load_instructions(loader)
		flows = [f for f in calculate(s) if f.metric == "forecast"]
		self.assertTrue(s.complete, s.warnings)
		self.assertEqual(sum(f.amount for f in flows), 120)
		self.assertEqual(sum(f.amount for f in flows if f.payment == Link("Payment Entry", "PE")), 120)

	def test_order_advance_refines_invoiced_and_unbilled_slices_without_duplicate(self):
		from dataclasses import replace

		from dinext_projects_pl.liquidity.calculation import calculate
		from dinext_projects_pl.liquidity.expected_sources import load_instructions
		from dinext_projects_pl.liquidity.model import Stage
		from dinext_projects_pl.tests.test_liquidity_projection import invoice, snapshot

		for order_rate, invoice_rate in ((D(1), D(1)), (D(3), D(4))):
			with self.subTest(order_rate=order_rate):
				inv = invoice(total=60 * invoice_rate, outstanding=40 * invoice_rate)
				order = replace(
					inv,
					source=Link("Sales Order", "ORDER"),
					total=100 * order_rate,
					outstanding=80 * order_rate,
					rate=order_rate,
					stages=[Stage("term", inv.stages[0].due, 100 * order_rate)],
				)
				order.shares = [
					replace(
						inv.shares[0],
						analytic=replace(inv.shares[0].analytic, order=order.source, invoice=None),
					)
				]
				inv.shares = [
					replace(inv.shares[0], analytic=replace(inv.shares[0].analytic, order=order.source))
				]
				inv.currency = order.currency = "EUR"
				inv.rate = invoice_rate
				s = snapshot(invoices=[inv], orders=[order])
				s.documents[inv.source].update(currency="EUR", grand_total=60, party_account_currency="EUR")
				s.documents[order.source].update(currency="EUR", grand_total=100)
				entry = frappe._dict(
					name="PE",
					docstatus=0,
					payment_type="Receive",
					posting_date=s.today,
					paid_from_account_currency="EUR",
					paid_to_account_currency="USD",
					source_exchange_rate=order_rate,
					target_exchange_rate=1,
					paid_amount=100,
					received_amount=100 * order_rate,
					base_paid_amount=100 * order_rate,
					base_received_amount=100 * order_rate,
				)
				row = frappe._dict(
					name="REF",
					parent="PE",
					reference_doctype=order.source.doctype,
					reference_name=order.source.name,
					allocated_amount=100,
				)
				loader = SimpleNamespace(
					snapshot=s,
					policy=s.policy,
					filters=SimpleNamespace(company="Demo"),
					docs={"Payment Entry": {}, "Payment Order": {}},
					pe_refs=[],
					po_rows=[],
					expected_fields=lambda _dt, fields: fields,
					parents=lambda dt, *_args, **_kwargs: [entry] if dt == "Payment Entry" else [],
					children=lambda dt, *_args, **_kwargs: [row] if dt == "Payment Entry Reference" else [],
				)
				load_instructions(loader)
				flows = [f for f in calculate(s) if f.metric == "forecast"]
				self.assertEqual(sum(f.amount for f in flows), 80 * order_rate)
				self.assertEqual(sum(f.amount for f in flows if f.analytic.invoice), 40 * order_rate)
