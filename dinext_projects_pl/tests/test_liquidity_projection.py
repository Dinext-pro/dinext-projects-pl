"""Expected financial identities, independent of ERP reads and display granularity."""

import unittest
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal as D

from dinext_projects_pl.liquidity.calculation import calculate
from dinext_projects_pl.liquidity.expected_sources import Instruction
from dinext_projects_pl.liquidity.model import (
	Analytic,
	Filters,
	Link,
	Obligation,
	Request,
	Share,
	Snapshot,
	Stage,
)
from dinext_projects_pl.liquidity.presentation import Calendar
from dinext_projects_pl.liquidity.settings import SUPPORTED, Policy, SourcePolicy

TODAY = date(2026, 10, 30)
A = Analytic("Project", "Customer", "Customer", "Contract")


def policy(enabled=None):
	if enabled is None:
		enabled = {
			("plan", "Sales Order"),
			("forecast", "Sales Invoice"),
			("forecast", "Payment Request"),
			("forecast", "Payment Order"),
			("forecast", "Payment Entry"),
		}
	priorities = {
		dt: index
		for index, types in enumerate(
			(SUPPORTED[:2], SUPPORTED[2:4], SUPPORTED[4:5], SUPPORTED[5:6], SUPPORTED[6:])
		)
		for dt in types
	}
	sources = tuple(
		SourcePolicy(
			metric,
			dt,
			(metric, dt) in enabled,
			(priorities[dt] + 1) * 10,
			(0,) if dt == "Payment Entry" else (1,),
			(),
			"payment_schedule"
			if dt in SUPPORTED[:4]
			else "transaction_date"
			if dt == "Payment Request"
			else "posting_date",
			"due_date" if dt in SUPPORTED[2:4] else "previous",
		)
		for metric in ("plan", "forecast")
		for dt in SUPPORTED
	)
	links = tuple(
		(a.metric, a.doctype, b.doctype)
		for a in sources
		for b in sources
		if a.metric == b.metric and a.priority < b.priority
	)
	return Policy(sources, links, "test-version")


def invoice(name="INV", total=60, outstanding=40, analytic=A, due=None):
	link = Link("Sales Invoice", name)
	return Obligation(
		link,
		"in",
		D(total),
		D(outstanding),
		"USD",
		D(1),
		[Stage("term", due or TODAY + timedelta(days=5), D(total))],
		[Share("item", D(1), replace(analytic, invoice=link))],
	)


def request(name="REQ", total=100, outstanding=100, analytic=A, due=None):
	return Request(
		Link("Payment Request", name),
		"in",
		D(outstanding),
		D(total),
		"USD",
		D(1),
		due or TODAY + timedelta(days=15),
		[Share("request", D(1), analytic)],
	)


def snapshot(invoices=(), requests=(), orders=(), config=None):
	s = Snapshot(
		TODAY,
		"USD",
		invoices=list(invoices),
		requests=list(requests),
		orders=list(orders),
		policy=config or policy(),
	)
	for obj in [*invoices, *orders, *requests]:
		s.documents[obj.source] = {
			"docstatus": 1,
			"status": "Requested",
			"creation": "2026-10-01 12:00:00",
			"posting_date": "2026-10-01",
			"transaction_date": obj.date.isoformat()
			if isinstance(obj, Request) and obj.date
			else "2026-10-02",
			"due_date": obj.stages[0].due.isoformat() if isinstance(obj, Obligation) and obj.stages else None,
		}
	return s


def amounts(s, metric="forecast"):
	return [f for f in calculate(s) if f.metric == metric]


class TestLiquidityProjection(unittest.TestCase):
	def test_gross_fifo_100_60_20_is_80_even_if_invoice_is_earlier(self):
		s = snapshot([invoice()], [request()])
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), 80)
		self.assertEqual(
			{(f.source.doctype, f.amount) for f in flows},
			{("Payment Request", D(40)), ("Sales Invoice", D(40))},
		)
		self.assertTrue(all(f.match_basis == "FIFO" for f in flows))

	def test_prepared_coverage_is_consumed_once_and_status_scopes_remain_independent(self):
		from dinext_projects_pl.liquidity.fifo import coverage

		s = snapshot([invoice()], [request()])
		s.coverage_parts = coverage(s, s.requests, s.invoices)
		self.assertEqual(sum(f.amount for f in amounts(s)), 80)
		self.assertIsNone(s.coverage_parts)
		s.invoices[0].total = s.invoices[0].outstanding = D(100)
		s.invoices[0].stages = [Stage("term", TODAY + timedelta(days=5), D(100))]
		self.assertEqual(sum(f.amount for f in amounts(s)), 100)

		s = snapshot([invoice()], [request()])
		s.documents[s.requests[0].source]["status"] = "Payment Ordered"
		s.policy = replace(
			s.policy,
			sources=tuple(
				replace(p, statuses=("Requested",))
				if p.metric == "forecast" and p.doctype == "Payment Request"
				else p
				for p in s.policy.sources
			),
		)
		s.coverage_parts = coverage(s, s.requests, s.invoices)
		self.assertEqual(sum(f.amount for f in amounts(s)), 40)

	def test_requested_metric_preserves_the_same_components_as_full_calculation(self):
		config = policy(
			{("plan", "Sales Invoice"), ("forecast", "Sales Invoice"), ("forecast", "Payment Request")}
		)
		s = snapshot([invoice()], [request()], config=config)
		full = calculate(s)
		for metric in ("plan", "forecast"):
			self.assertEqual(
				calculate(s, expected_metrics=(metric,)), [f for f in full if f.metric == metric]
			)
		self.assertEqual(calculate(s, expected_metrics=()), [])

	def test_paid_invoice_remains_in_coverage(self):
		s = snapshot([invoice(outstanding=0)], [request()])
		self.assertEqual(sum(f.amount for f in amounts(s)), 40)

	def test_shared_payment_is_not_subtracted_twice(self):
		r = request(outstanding=80)
		r.paid_by_invoice[Link("Sales Invoice", "INV")] = D(20)
		self.assertEqual(sum(f.amount for f in amounts(snapshot([invoice()], [r]))), 80)
		r.paid_by_invoice.clear()
		self.assertEqual(sum(f.amount for f in amounts(snapshot([invoice()], [r]))), 60)

	def test_conflicting_orders_and_analytical_mismatch_do_not_match(self):
		for changed in (
			replace(A, project="Other"),
			replace(A, contract=""),
			replace(A, party="Other"),
			replace(A, party_type="Supplier"),
			replace(A, order=Link("Sales Order", "B")),
		):
			inv = invoice(analytic=replace(A, order=Link("Sales Order", "A")))
			r = request(analytic=changed)
			self.assertEqual(sum(f.amount for f in amounts(snapshot([inv], [r]))), 140)
		self.assertEqual(
			sum(
				f.amount
				for f in amounts(
					snapshot([invoice(analytic=replace(A, order=Link("Sales Order", "A")))], [request()])
				)
			),
			80,
		)

	def test_currency_and_direction_never_match(self):
		for inv in (replace(invoice(), currency="EUR"), replace(invoice(), direction="out")):
			self.assertEqual(sum(f.amount for f in amounts(snapshot([inv], [request()]))), 140)

	def test_stable_fifo_and_explicit_allocations_first(self):
		first, second = request("A", 60, 60), request("B", 40, 40)
		inv = invoice(total=100, outstanding=100)
		second.gross_coverage[inv.source] = D(40)
		s = snapshot([inv], [second, first])
		self.assertEqual(sum(f.amount for f in amounts(s)), 100)
		allocations = [a for a in s.allocations if a["metric"] == "forecast"]
		self.assertEqual(
			[(a["request"].name, a["basis"], a["covered_original"]) for a in allocations],
			[("B", "explicit", D(40)), ("A", "FIFO", D(60))],
		)

	def test_invoice_split_matches_only_compatible_project(self):
		inv = invoice(total=100, outstanding=100)
		inv.shares.append(Share("other", D(1), replace(A, project="Other", invoice=inv.source)))
		s = snapshot([inv], [request(total=60, outstanding=60)])
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), 110)
		self.assertEqual(
			sum(f.amount for f in flows if f.match_basis == "FIFO" and f.source.doctype == "Sales Invoice"),
			50,
		)

	def test_sources_control_both_metrics_independently(self):
		config = policy(
			{("plan", "Sales Invoice"), ("plan", "Payment Request"), ("forecast", "Payment Request")}
		)
		s = snapshot([invoice()], [request()], config=config)
		self.assertEqual(sum(f.amount for f in amounts(s, "plan")), 80)
		self.assertEqual(sum(f.amount for f in amounts(s)), 80)
		config = policy({("forecast", "Sales Invoice")})
		s.policy = config
		self.assertEqual(sum(f.amount for f in amounts(s)), 40)

	def test_date_and_links_change_refinement_without_changing_debt(self):
		inv, req = invoice(), request()
		s = snapshot([inv], [req])
		refined = next(f for f in amounts(s) if f.source == inv.source)
		self.assertEqual(refined.date, req.date)
		s.policy = replace(s.policy, links=())
		base = next(f for f in amounts(s) if f.source == inv.source)
		self.assertEqual(base.date, inv.stages[0].due)
		self.assertEqual(sum(f.amount for f in amounts(s)), 80)
		s.policy = replace(
			s.policy,
			sources=tuple(
				replace(p, date_field="creation") if p.doctype == "Payment Request" else p
				for p in s.policy.sources
			),
		)
		self.assertEqual(next(f for f in amounts(s) if f.source == req.source).date, TODAY)

	def test_payment_order_then_draft_entry_refines_only_allocated_amount(self):
		inv, req = invoice(), request()
		s = snapshot([inv], [req])
		po, pe = Link("Payment Order", "PO"), Link("Payment Entry", "PE")
		s.documents[po] = {"docstatus": 1, "posting_date": "2026-11-20"}
		s.documents[pe] = {"docstatus": 0, "posting_date": "2026-11-25"}
		s.instructions = [
			Instruction(po, "po-invoice", inv.source, "in", D(60), D(40), "USD", D(1), tuple(inv.shares)),
			Instruction(po, "po-uncovered", req.source, "in", D(40), D(40), "USD", D(1), tuple(req.shares)),
			Instruction(pe, "pe-row", inv.source, "in", D(20), D(20), "USD", D(1), tuple(inv.shares)),
		]
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), 80)
		self.assertEqual(sum(f.amount for f in flows if f.date_source == pe), 20)
		self.assertEqual(sum(f.amount for f in flows if f.date_source == po), 60)

	def test_non_overlapping_orders_refine_disjoint_slices_and_overlap_keeps_base(self):
		inv = invoice()
		s = snapshot([inv])
		for name, day in (("A", "2026-11-20"), ("B", "2026-11-25")):
			po = Link("Payment Order", name)
			s.documents[po] = {"docstatus": 1, "posting_date": day}
			s.instructions.append(
				Instruction(po, "row-" + name, inv.source, "in", D(20), D(20), "USD", D(1), tuple(inv.shares))
			)
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), 40)
		self.assertEqual({f.date for f in flows}, {date(2026, 11, 20), date(2026, 11, 25)})
		s.instructions = [replace(i, remaining=D(40), total=D(40)) for i in s.instructions]
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), 40)
		self.assertEqual({f.date for f in flows}, {inv.stages[0].due})
		self.assertFalse(s.complete)

	def test_original_currency_fifo_conserves_company_cents(self):
		inv = replace(invoice(total="1", outstanding="1"), currency="EUR", rate=D("3.334"))
		requests = [
			replace(request(str(i), ".3334", ".3334"), currency="EUR", rate=D("3.334")) for i in range(3)
		]
		flows = amounts(snapshot([inv], requests))
		self.assertEqual(sum(f.amount for f in flows), D("1.00"))
		self.assertEqual(sum(f.original_amount for f in flows), D(".30"))
		self.assertEqual(sorted(f.amount for f in flows), [D(".33"), D(".33"), D(".34")])

	def test_cent_stages_conserve_both_analytical_shares_when_only_requests_participate(self):
		inv = invoice(total=".02", outstanding=".02")
		other = replace(A, project="Other")
		inv.shares.append(Share("other", D(1), replace(other, invoice=inv.source)))
		inv.stages = [Stage("first", TODAY, D(".01")), Stage("second", TODAY + timedelta(days=1), D(".01"))]
		requests = [request("A", ".01", ".01"), request("B", ".01", ".01", analytic=other)]
		s = snapshot([inv], requests, config=policy({("forecast", "Payment Request")}))
		flows = amounts(s)
		self.assertEqual(sum(f.amount for f in flows), D(".02"))
		self.assertEqual(
			{f.analytic.project: f.amount for f in flows}, {"Project": D(".01"), "Other": D(".01")}
		)

	def test_schedule_fallback_is_explicit_and_datetime_uses_site_timezone(self):
		inv = invoice(total=100, outstanding=100)
		inv.stages = [Stage("document", TODAY + timedelta(days=7), D(100))]
		s = snapshot([inv])
		s.policy = replace(
			s.policy,
			sources=tuple(
				replace(p, fallback="undated") if p.doctype == "Sales Invoice" else p
				for p in s.policy.sources
			),
		)
		self.assertIsNone(amounts(s)[0].date)
		s.policy = replace(
			s.policy,
			sources=tuple(
				replace(p, date_field="creation") if p.doctype == "Sales Invoice" else p
				for p in s.policy.sources
			),
		)
		s.timezone = "Europe/Moscow"
		s.documents[inv.source]["creation"] = "2026-11-03T23:30:00+00:00"
		self.assertEqual(amounts(s)[0].date, date(2026, 11, 4))

	def test_configured_pre_range_flow_changes_projected_opening(self):
		r = request(total=100, outstanding=100, due=TODAY + timedelta(days=2))
		s = snapshot([], [r])
		s.can_balance = True
		s.current_cash = D(200)
		filters = Filters.parse(
			{
				"company": "Company",
				"from_date": (TODAY + timedelta(days=10)).isoformat(),
				"to_date": (TODAY + timedelta(days=20)).isoformat(),
			},
			TODAY,
		)
		result = Calendar(filters, s, calculate(s)).payload()
		self.assertEqual(result["balances"]["periods"][0]["projected_opening"], 300)
		s.policy = policy(set())
		result = Calendar(filters, s, calculate(s)).payload()
		self.assertEqual(result["balances"]["periods"][0]["projected_opening"], 200)
		self.assertEqual(result["balances"]["current_cash"], 200)
