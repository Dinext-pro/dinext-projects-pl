"""Read-only coverage of scoped, non-additive payment-stage diagnostics."""

import unittest
from dataclasses import asdict, replace
from datetime import date
from decimal import Decimal as D
from unittest.mock import Mock, patch

import frappe

from dinext_projects_pl.liquidity import details
from dinext_projects_pl.liquidity.model import Analytic, Filters, Flow, Link, Request, Share, Snapshot
from dinext_projects_pl.liquidity.presentation import wire


class TestLiquidityDetails(unittest.TestCase):
	def setUp(self):
		self.day = date(2026, 10, 29)
		self.invoice = Link("Purchase Invoice", "PI-1")
		self.request_link = Link("Payment Request", "PR-1")
		self.order_link = Link("Payment Order", "PO-1")
		self.payment_link = Link("Payment Entry", "PE-1")
		self.analytic = Analytic(project="Allowed", invoice=self.invoice)
		self.request = Request(
			self.request_link,
			"out",
			D(160),
			D(200),
			"EUR",
			D(2),
			self.day,
			[Share("a", D(1), self.analytic), Share("b", D(3), replace(self.analytic, project="Hidden"))],
			coverage={self.invoice: D(160)},
			invoice_only=True,
			links=(self.order_link,),
		)
		self.snapshot = Snapshot(self.day, "USD", requests=[self.request])
		self.flow = Flow(
			"flow-1",
			"forecast",
			"out",
			D(40),
			self.day,
			self.day,
			self.invoice,
			self.analytic,
			"EUR",
			D(20),
			links=(self.request_link, self.order_link),
			date_source=self.request_link,
		)
		self.filters = Filters("Company", self.day, self.day, projects=("Allowed",))
		self.documents = {
			self.request_link: frappe._dict(name="PR-1", status="Requested", grand_total=999999),
			self.order_link: frappe._dict(name="PO-1", status="Pending", total=999999),
			self.payment_link: frappe._dict(name="PE-1", status="Submitted", paid_amount=999999),
		}
		self.po_rows = [
			frappe._dict(
				parent="PO-1",
				payment_request="PR-1",
				reference_doctype="Purchase Invoice",
				reference_name="PI-1",
				amount=60,
			)
		]
		self.loader = Mock()
		self.loader.parents.side_effect = lambda dt, fields, filters: [
			doc
			for link, doc in self.documents.items()
			if link.doctype == dt and link.name in filters["name"][1]
		]
		self.loader.children.side_effect = lambda dt, parenttype, names, fields: [
			row for row in self.po_rows if row.parent in names
		]
		self.patch = patch.object(details, "Loader", return_value=self.loader)
		self.patch.start()
		self.addCleanup(self.patch.stop)

	def decorate(self, *flows):
		result = {"rows": [wire(asdict(flow)) for flow in flows or [self.flow]], "total": 40}
		return details.decorate_details(result, self.filters, self.snapshot)

	def stage(self, result, doctype):
		return next(stage for stage in result["rows"][0]["payment_stages"] if stage["doctype"] == doctype)

	def test_request_and_order_amounts_are_only_the_permitted_analytic_share(self):
		result = self.decorate()
		request = self.stage(result, "Payment Request")
		self.assertEqual((request["requested"], request["remaining"], request["settled"]), (50, 40, 10))
		self.assertEqual(request["currency"], "USD")
		self.assertEqual(request["scope"], "analytical_share")
		self.assertTrue(request["non_additive"])
		self.assertEqual(request["docstatus"], 1)
		self.assertEqual(request["status"], "Requested")
		self.assertIsNone(request["executed"])
		self.assertEqual(self.stage(result, "Payment Order")["ordered"], 30)
		self.assertNotIn("Hidden", repr(result))
		self.assertNotIn("999999", repr(result))
		self.assertEqual(result["total"], 40)

	def test_order_ignores_other_requests_and_other_invoice_rows(self):
		self.po_rows.extend(
			[
				frappe._dict(
					parent="PO-1",
					payment_request="PR-OTHER",
					reference_doctype="Purchase Invoice",
					reference_name="PI-1",
					amount=900,
				),
				frappe._dict(
					parent="PO-1",
					payment_request="PR-1",
					reference_doctype="Purchase Invoice",
					reference_name="PI-OTHER",
					amount=800,
				),
			]
		)
		self.assertEqual(self.stage(self.decorate(), "Payment Order")["ordered"], 30)

	def test_multiple_invoice_coverage_remains_explicitly_unattributed(self):
		self.request.coverage[Link("Purchase Invoice", "PI-2")] = D(20)
		for stage in self.decorate()["rows"][0]["payment_stages"]:
			self.assertEqual(stage["amounts_reason"], "ambiguous_allocation")
			self.assertTrue(
				all(
					stage[key] is None for key in ("requested", "ordered", "remaining", "settled", "executed")
				)
			)

	def test_stage_reference_identity_preserves_rounding_remainder(self):
		self.request.total = D("0.04")
		self.request.outstanding = D("0.02")
		request = self.stage(self.decorate(), "Payment Request")
		self.assertEqual(request["requested"], 0.01)
		self.assertEqual(request["remaining"], 0)
		self.assertEqual(request["settled"], 0.01)

	def test_hidden_stage_document_is_not_queried_for_children_or_returned(self):
		del self.documents[self.order_link]
		result = self.decorate()
		self.assertEqual(
			[stage["doctype"] for stage in result["rows"][0]["payment_stages"]], ["Payment Request"]
		)
		self.assertEqual(self.loader.children.call_args.args[2], [])

	def test_hidden_request_cannot_supply_an_order_total(self):
		del self.documents[self.request_link]
		result = self.decorate()
		self.assertEqual(
			[stage["doctype"] for stage in result["rows"][0]["payment_stages"]], ["Payment Order"]
		)
		self.assertIsNone(self.stage(result, "Payment Order")["ordered"])

	def test_cash_execution_is_component_amount_not_payment_document_total(self):
		flow = replace(
			self.flow,
			source=self.payment_link,
			metric="actual",
			amount=D(7),
			date_source=None,
			links=(self.request_link, self.order_link, self.payment_link),
		)
		payment = self.stage(self.decorate(flow), "Payment Entry")
		self.assertEqual(payment["executed"], 7)
		self.assertEqual(payment["scope"], "component")
		self.assertEqual(payment["currency"], "USD")
		self.assertIsNone(payment["settled"])

	def test_forecast_linked_payment_is_not_relabelled_as_execution(self):
		flow = replace(self.flow, links=(*self.flow.links, self.payment_link))
		self.assertIsNone(self.stage(self.decorate(flow), "Payment Entry")["executed"])

	def test_direct_standalone_request_has_safe_branch_amounts(self):
		analytic = replace(self.analytic, invoice=None)
		self.request.invoice_only = False
		self.request.coverage = {}
		self.request.shares = [Share("a", D(1), analytic)]
		flow = replace(self.flow, source=self.request_link, analytic=analytic)
		request = self.stage(self.decorate(flow), "Payment Request")
		self.assertEqual((request["requested"], request["remaining"]), (200, 160))

	def test_missing_exact_analytic_is_not_inferred_from_project(self):
		flow = replace(self.flow, analytic=replace(self.analytic, party="Other supplier"))
		self.assertIsNone(self.stage(self.decorate(flow), "Payment Request")["requested"])

	def test_metadata_reads_are_batched_by_doctype_for_the_returned_page(self):
		self.decorate(*[replace(self.flow, id=f"flow-{i}") for i in range(50)])
		self.assertEqual(self.loader.parents.call_count, 2)
		for call in self.loader.parents.call_args_list:
			self.assertEqual(call.args[1], ["status", "docstatus"])
			self.assertEqual(call.args[2]["docstatus"], ["in", [0, 1]])
			self.assertEqual(call.args[2]["company"], "Company")
		self.assertEqual(self.loader.children.call_count, 1)

	def test_empty_detail_page_performs_no_reads(self):
		result = {"rows": []}
		self.assertIs(details.decorate_details(result, self.filters, self.snapshot), result)
		self.loader.parents.assert_not_called()
