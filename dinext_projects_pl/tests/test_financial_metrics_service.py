# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import unittest
from datetime import date
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.financial_metrics.calculations import (
	build_financial_metrics_payload,
	build_track_metrics,
	get_actual_factor,
	get_plan_factor,
)
from dinext_projects_pl.dinext_projects_pl.financial_metrics.data import get_track_period_totals
from dinext_projects_pl.dinext_projects_pl.financial_metrics.service import get_project_financial_metrics
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.actual_loader import (
	get_actual_data_simple,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.budget_loader import (
	get_raw_budget_data_for_project,
	process_project_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.query_builder import (
	build_budget_raw_query,
	build_gl_actual_query,
)


class TestFinancialMetricsCalculations(unittest.TestCase):
	def test_plan_factor_prorates_current_month_by_reporting_day(self):
		period = {"year": 2026, "month": 1}
		reporting_date = date(2026, 1, 15)

		self.assertEqual(get_plan_factor(period, reporting_date), 15 / 31)
		self.assertEqual(get_actual_factor(period, reporting_date), 15 / 31)

	def test_build_track_metrics_matches_reference_case(self):
		periods = [{"year": 2026, "month": 1}]
		period_totals = {(2026, 1): {"plan": 400, "fact": 100}}
		track = build_track_metrics(
			"Expense",
			periods,
			period_totals,
			date(2026, 1, 15),
			50,
		)

		self.assertEqual(track["values"]["BAC"], 400)
		self.assertEqual(track["values"]["EV"], 200)
		self.assertAlmostEqual(track["values"]["PV"], 400 * (15 / 31))
		self.assertAlmostEqual(track["values"]["AC"], 100 * (15 / 31))

	def test_zero_progress_adds_warning(self):
		project = frappe._dict(
			expected_start_date="2026-01-01",
			expected_end_date="2026-03-31",
			percent_complete=0,
		)
		payload = build_financial_metrics_payload(
			project,
			"2026-01-15",
			[{"year": 2026, "month": 1}],
			{
				"Income": {(2026, 1): {"plan": 0, "fact": 0}},
				"Expense": {(2026, 1): {"plan": 0, "fact": 0}},
			},
		)

		self.assertTrue(payload["ready"])
		progress_label = frappe.get_meta("Project").get_label("percent_complete") or "Процент выполнения"
		self.assertIn(progress_label, payload["warning"])
		self.assertNotIn("Project.percent_complete", payload["warning"])


class TestFinancialMetricsService(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		cls.expense_account = cls._get_expense_account(cls.company)
		cls.income_account = cls._get_income_account(cls.company)

	def setUp(self):
		self.project = self._make_project()

	def tearDown(self):
		self._cleanup_project_data(self.project.name)

	def test_missing_project_dates_return_not_ready_payload(self):
		project = frappe.get_doc("Project", self.project.name)
		project.db_set(
			{
				"expected_start_date": None,
				"expected_end_date": None,
			},
			update_modified=False,
		)

		payload = get_project_financial_metrics(self.project.name, "2026-01-15")

		self.assertFalse(payload["ready"])
		self.assertEqual(payload["tracks"], [])

	def test_service_returns_tracks_for_seeded_project_budget(self):
		project = frappe.get_doc("Project", self.project.name)
		project.db_set(
			{
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-03-31",
				"percent_complete": 50,
			},
			update_modified=False,
		)

		self._seed_project_budget(
			self.expense_account,
			[],
			{(2026, 1): {"plan": 400, "expected": 0}},
		)

		payload = get_project_financial_metrics(self.project.name, "2026-01-15")

		self.assertTrue(payload["ready"])
		self.assertEqual(len(payload["tracks"]), 2)
		expense_track = next(track for track in payload["tracks"] if track["key"] == "expense")
		self.assertEqual(expense_track["values"]["BAC"], 400)
		self.assertEqual(expense_track["values"]["EV"], 200)

	def test_service_uses_parent_plan_without_double_counting_child_accounts(self):
		project = frappe.get_doc("Project", self.project.name)
		project.db_set(
			{
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-03-31",
				"percent_complete": 50,
			},
			update_modified=False,
		)

		parent_expense_account = frappe.db.get_value("Account", self.expense_account, "parent_account")
		if not parent_expense_account:
			self.skipTest("Expense account does not have a parent account in the test chart of accounts")

		self._seed_project_budget(
			parent_expense_account,
			[],
			{(2026, 1): {"plan": 100, "expected": 0}},
		)
		self._seed_project_budget(
			self.expense_account,
			[],
			{(2026, 1): {"plan": 40, "expected": 0}},
		)

		payload = get_project_financial_metrics(self.project.name, "2026-01-15")

		expense_track = next(track for track in payload["tracks"] if track["key"] == "expense")
		self.assertEqual(expense_track["values"]["BAC"], 100)

	def test_service_returns_zero_money_without_pb_or_gl_read(self):
		project = frappe.get_doc("Project", self.project.name)
		project.db_set(
			{
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-03-31",
				"percent_complete": 50,
			},
			update_modified=False,
		)
		self._seed_project_budget(
			self.expense_account,
			[],
			{(2026, 1): {"plan": 400, "expected": 0}},
		)

		real_has_permission = frappe.has_permission

		def _perm(doctype, ptype="read", *args, **kwargs):
			if doctype in ("Project Budget", "GL Entry"):
				return False
			return real_has_permission(doctype, ptype, *args, **kwargs)

		with patch("frappe.has_permission", side_effect=_perm):
			payload = get_project_financial_metrics(self.project.name, "2026-01-15")

		self.assertTrue(payload["ready"])
		expense_track = next(track for track in payload["tracks"] if track["key"] == "expense")
		self.assertEqual(expense_track["values"]["BAC"], 0)
		self.assertEqual(expense_track["values"]["AC"], 0)

	def test_track_totals_skip_bvf_when_no_pb_gl_read(self):
		project = frappe.get_doc("Project", self.project.name)
		with (
			patch(
				"dinext_projects_pl.dinext_projects_pl.financial_metrics.data.can_read_doctype",
				return_value=False,
			),
			patch(
				"dinext_projects_pl.dinext_projects_pl.financial_metrics.data._collect_project_plan_rows"
			) as collect_plan,
			patch(
				"dinext_projects_pl.dinext_projects_pl.financial_metrics.data._collect_actual_values"
			) as collect_actual,
		):
			periods, totals = get_track_period_totals(project)

		self.assertTrue(periods)
		self.assertEqual(totals["Income"], {})
		self.assertEqual(totals["Expense"], {})
		collect_plan.assert_not_called()
		collect_actual.assert_not_called()

	def test_track_totals_use_only_list_readable_names(self):
		project = frappe.get_doc("Project", self.project.name)
		visible_pb = self._seed_project_budget(
			self.expense_account,
			[],
			{(2026, 1): {"plan": 400, "expected": 0}},
		)
		self._seed_project_budget(
			self.expense_account,
			[],
			{(2026, 1): {"plan": 100, "expected": 0}},
		)

		_, full_totals = get_track_period_totals(project)
		full_plan = full_totals["Expense"][(2026, 1)]["plan"]
		self.assertEqual(full_plan, 500)

		filters = {
			"project": self.project.name,
			"company": self.company,
			"from_year": 2026,
			"to_year": 2026,
			"from_month": 1,
			"to_month": 3,
		}
		unfiltered_rows = get_raw_budget_data_for_project(self.project.name, filters)
		self.assertGreaterEqual(len(unfiltered_rows), 2)

		def _subset_list_readable(doctype, filters=None, fields=None):
			if doctype == "Project Budget":
				return [visible_pb.name]
			return []

		with (
			patch(
				"dinext_projects_pl.dinext_projects_pl.project_budget.amounts.list_readable",
				side_effect=_subset_list_readable,
			),
			patch(
				"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.budget_loader.get_raw_budget_data_for_project",
				wraps=get_raw_budget_data_for_project,
			) as raw_spy,
			patch(
				"dinext_projects_pl.dinext_projects_pl.financial_metrics.data.get_actual_data_simple",
				wraps=get_actual_data_simple,
			) as actual_spy,
		):
			_, subset_totals = get_track_period_totals(project)

		subset_plan = subset_totals["Expense"][(2026, 1)]["plan"]
		self.assertEqual(subset_plan, 400)
		self.assertNotEqual(subset_plan, full_plan)
		raw_spy.assert_called()
		self.assertEqual(raw_spy.call_args.kwargs.get("pb_names"), [visible_pb.name])
		actual_spy.assert_called()
		self.assertEqual(actual_spy.call_args.kwargs.get("gle_names"), [])

	def test_unfiltered_bvf_queries_omit_name_filters(self):
		filters = {
			"company": self.company,
			"project": self.project.name,
			"from_year": 2026,
			"to_year": 2026,
			"from_month": 1,
			"to_month": 3,
		}
		budget_sql = str(build_budget_raw_query(filters, project=self.project.name))
		self.assertNotIn("__no_readable_doc__", budget_sql)
		self.assertNotIn("PB-VISIBLE-ONLY", budget_sql)

		named_budget_sql = str(
			build_budget_raw_query(filters, project=self.project.name, pb_names=["PB-VISIBLE-ONLY"])
		)
		self.assertIn("PB-VISIBLE-ONLY", named_budget_sql)

		gl_sql = str(build_gl_actual_query(filters, "2026-01-01", "2026-03-31"))
		self.assertNotIn("__no_readable_doc__", gl_sql)
		self.assertNotIn("GLE-VISIBLE-ONLY", gl_sql)

		named_gl_sql = str(
			build_gl_actual_query(filters, "2026-01-01", "2026-03-31", gle_names=["GLE-VISIBLE-ONLY"])
		)
		self.assertIn("GLE-VISIBLE-ONLY", named_gl_sql)

		self.assertEqual(get_actual_data_simple(filters, gle_names=[]), [])
		self.assertEqual(process_project_data(self.project.name, filters, pb_names=[]), [])

	@classmethod
	def _get_expense_account(cls, company):
		account = frappe.db.get_value(
			"Account",
			{"company": company, "is_group": 0, "report_type": "Profit and Loss", "root_type": "Expense"},
			"name",
		)
		if not account:
			raise AssertionError("No expense Profit and Loss account found for test company")
		return account

	@classmethod
	def _get_income_account(cls, company):
		account = frappe.db.get_value(
			"Account",
			{"company": company, "is_group": 0, "report_type": "Profit and Loss", "root_type": "Income"},
			"name",
		)
		if not account:
			raise AssertionError("No income Profit and Loss account found for test company")
		return account

	@classmethod
	def _make_project(cls):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-EVM-PROJ-{frappe.generate_hash(length=6)}",
				"project_name": f"EVM Metrics {frappe.generate_hash(length=6)}",
				"company": cls.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-03-31",
				"percent_complete": 50,
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	def _seed_project_budget(self, account, dimensions, amounts_by_period):
		project_budget = frappe.new_doc("Project Budget")
		project_budget.pb_project = self.project.name
		project_budget.pb_account = account
		for dimension in dimensions:
			project_budget.append("project_budget_dimension", dimension)
		for (year, month), values in sorted(amounts_by_period.items()):
			project_budget.append(
				"project_budget_amount",
				{
					"pba_year": year,
					"pba_month": month,
					"pba_plan": values.get("plan", 0),
					"pba_expected": values.get("expected", 0),
				},
			)
		project_budget.save(ignore_permissions=True)
		return project_budget

	@staticmethod
	def _cleanup_project_data(project_name):
		project_budget_names = frappe.get_all(
			"Project Budget",
			filters={"pb_project": project_name},
			fields=["name"],
		)
		for row in project_budget_names:
			frappe.delete_doc("Project Budget", row.name, ignore_permissions=True, force=1)

		if frappe.db.exists("Project", project_name):
			frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)
