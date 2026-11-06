"""Read-only cash boundary tests: real ledger shapes without a database/site."""

import unittest
from collections import defaultdict
from datetime import date
from decimal import Decimal

import frappe

from dinext_projects_pl.liquidity.model import Analytic, Filters, Link, Share, Snapshot
from dinext_projects_pl.liquidity.sources import Loader


class TestLiquidityCashAllocation(unittest.TestCase):
	def loader(
		self, *, cash=(103,), references=(("PI-1", 100),), hidden=(), payment=False, accounts=(), rate=1
	):
		loader = object.__new__(Loader)
		day = date(2026, 10, 29)
		loader.filters = Filters("Company", day, day, accounts=accounts)
		loader.snapshot = Snapshot(day, "USD")
		loader.shares = {}
		for name, _amount in references:
			if name not in hidden:
				invoice = Link("Purchase Invoice", name)
				loader.shares[invoice] = [
					Share(name, Decimal(1), Analytic(project="Allowed", invoice=invoice))
				]
		voucher_type = "Payment Entry" if payment else "Journal Entry"
		doc = frappe._dict(
			name="PAY-1",
			payment_type="Pay" if payment else None,
			target_exchange_rate=rate,
			base_paid_amount=sum(cash),
		)
		loader.docs = {voucher_type: {doc.name: doc}, "Payment Request": {}, "Payment Order": {}}
		loader.payment_orders_by_voucher = defaultdict(set)
		loader.requests_by_order_reference = defaultdict(set)
		rows = [
			frappe._dict(
				name=f"ref-{i}",
				parent=doc.name,
				reference_doctype="Purchase Invoice" if payment else None,
				reference_type=None if payment else "Purchase Invoice",
				reference_name=name,
				allocated_amount=amount if payment else None,
				debit=amount if not payment else None,
				party="Supplier",
			)
			for i, (name, amount) in enumerate(references)
		]
		loader.pe_refs = rows if payment else []
		loader.je_rows = [] if payment else rows
		gl = [
			frappe._dict(
				name=f"gl-{i}",
				posting_date=day,
				account=f"Bank-{i}",
				debit=max(-amount, 0),
				credit=max(amount, 0),
				debit_in_account_currency=max(-amount, 0),
				credit_in_account_currency=max(amount, 0),
				account_currency="USD",
				voucher_type=voucher_type,
				voucher_no=doc.name,
			)
			for i, amount in enumerate(cash)
		]
		loader.parents = lambda doctype, *_args: (
			[frappe._dict(name=row.account) for row in gl] if doctype == "Account" else gl
		)
		return loader

	def amounts(self, loader, metric="actual"):
		loader.load_cash()
		result = defaultdict(lambda: Decimal(0))
		for flow in loader.snapshot.actual:
			if flow.metric == metric:
				result[flow.analytic.invoice.name if flow.analytic.invoice else None] += flow.amount
		return dict(result)

	def test_journal_fee_does_not_inflate_invoice_or_project(self):
		loader = self.loader()
		self.assertEqual(self.amounts(loader), {"PI-1": 100, None: 3})
		fee = next(flow for flow in loader.snapshot.actual if flow.analytic.invoice is None)
		self.assertEqual(fee.analytic.project, "")

	def test_journal_cash_spread_across_bank_legs_preserves_invoice_and_fee(self):
		self.assertEqual(self.amounts(self.loader(cash=(40, 63))), {"PI-1": 100, None: 3})

	def test_account_filter_keeps_the_same_rounded_slice(self):
		full = self.loader(cash=(40, 63))
		full.load_cash()
		selected = self.loader(cash=(40, 63), accounts=("Bank-1",))
		selected.load_cash()
		self.assertEqual(
			selected.snapshot.actual, [flow for flow in full.snapshot.actual if flow.account == "Bank-1"]
		)

	def test_receipt_uses_source_exchange_rate_for_hidden_reference(self):
		loader = self.loader(
			cash=(-100,),
			references=(("PI-1", 30), ("PI-HIDDEN", 20)),
			hidden=("PI-HIDDEN",),
			payment=True,
			rate=99,
		)
		loader.docs["Payment Entry"]["PAY-1"].update(payment_type="Receive", source_exchange_rate=2)
		self.assertEqual(self.amounts(loader), {"PI-1": 60})
		self.assertTrue(all(flow.direction == "in" for flow in loader.snapshot.actual))

	def test_journal_hidden_invoice_keeps_denominator_and_is_not_anonymous_cash(self):
		loader = self.loader(cash=(103,), references=(("PI-1", 60), ("PI-HIDDEN", 40)), hidden=("PI-HIDDEN",))
		self.assertEqual(self.amounts(loader), {"PI-1": 60, None: 3})
		self.assertFalse(loader.snapshot.complete)
		self.assertNotIn("PI-HIDDEN", repr(loader.snapshot.actual))

	def test_journal_only_hidden_invoice_does_not_become_unallocated_cash(self):
		loader = self.loader(cash=(100,), references=(("PI-HIDDEN", 100),), hidden=("PI-HIDDEN",))
		self.assertEqual(self.amounts(loader), {})
		self.assertFalse(loader.snapshot.complete)

	def test_foreign_payment_hidden_invoice_uses_payment_rate(self):
		loader = self.loader(
			cash=(103,),
			references=(("PI-1", 30), ("PI-HIDDEN", 20)),
			hidden=("PI-HIDDEN",),
			payment=True,
			rate=2,
		)
		self.assertEqual(self.amounts(loader), {"PI-1": 60, None: 3})
		self.assertFalse(loader.snapshot.complete)
		self.assertNotIn("PI-HIDDEN", repr(loader.snapshot.actual))

	def test_missing_payment_exchange_rate_withholds_uncertain_cash(self):
		loader = self.loader(cash=(100,), payment=True, rate=0)
		self.assertEqual(self.amounts(loader), {})
		self.assertFalse(loader.snapshot.complete)

	def test_genuine_unallocated_payment_remains_visible(self):
		loader = self.loader(cash=(100,), references=(), payment=True)
		self.assertEqual(self.amounts(loader), {None: 100})
		self.assertTrue(loader.snapshot.complete)

	def test_selected_account_internal_transfer_is_not_invoice_payment(self):
		loader = self.loader(cash=(133, -100), references=(("PI-1", 30),), accounts=("Bank-0",))
		self.assertEqual(self.amounts(loader), {"PI-1": 30, None: 3})
		transfers = [flow for flow in loader.snapshot.actual if flow.metric == "transfer"]
		self.assertEqual(sum(flow.amount for flow in transfers), 100)
		self.assertTrue(all(flow.analytic.invoice is None for flow in transfers))
		self.assertEqual(loader.snapshot.current_cash, -133)
