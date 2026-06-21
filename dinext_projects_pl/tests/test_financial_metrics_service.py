# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import unittest
from datetime import date

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.financial_metrics.calculations import (
	build_financial_metrics_payload,
	build_track_metrics,
	get_actual_factor,
	get_plan_factor,
)
from dinext_projects_pl.dinext_projects_pl.financial_metrics.service import get_project_financial_metrics


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
