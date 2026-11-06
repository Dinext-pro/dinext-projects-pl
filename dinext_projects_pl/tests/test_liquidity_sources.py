"""Batch adapter regression: configured requests must not trigger a legacy N² scan."""

import unittest
from datetime import date
from decimal import Decimal

import frappe

from dinext_projects_pl.liquidity.model import Analytic, Link, Obligation, Share, Snapshot
from dinext_projects_pl.liquidity.sources import Loader


class CountedInvoices(list):
	visits = 0

	def __iter__(self):
		for invoice in super().__iter__():
			self.visits += 1
			yield invoice


class TestRequestBatching(unittest.TestCase):
	def test_configured_requests_scan_invoices_in_batches(self):
		count = 1000
		loader = Loader.__new__(Loader)
		loader.snapshot = Snapshot(date(2026, 10, 30), "USD")
		loader.policy = object()
		loader.parents = lambda *_args, **_kwargs: []
		loader.contracts, loader.shares = {}, {}
		loader.pe_refs, loader.po_rows, loader.je_rows = [], [], []
		loader.docs = {"Payment Request": {}}
		loader.snapshot.invoices = CountedInvoices()
		for index in range(count):
			order = Link("Sales Order", str(index))
			loader.docs["Payment Request"][str(index)] = frappe._dict(
				name=str(index),
				currency="USD",
				transaction_date="2026-10-30",
				status="Requested",
				docstatus=1,
				grand_total=100,
				outstanding_amount=100,
				party_account_currency="USD",
				reference_doctype=order.doctype,
				reference_name=order.name,
				party_type="Customer",
				party="Demo",
				payment_request_type="Inward",
			)
			loader.snapshot.invoices.append(
				Obligation(
					Link("Sales Invoice", str(index)),
					"in",
					Decimal(60),
					Decimal(40),
					"USD",
					Decimal(1),
					[],
					[Share(str(index), Decimal(1), Analytic(order=order))],
				)
			)
		loader.build_requests()
		self.assertEqual(len(loader.snapshot.requests), count)
		self.assertLessEqual(
			loader.snapshot.invoices.visits,
			count * 3,
			"An invoice pass per request makes the real FIFO workload quadratic",
		)
