# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.budget_loader import (
	get_raw_budget_data_for_project,
	process_project_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
)


class TestProjectBudgetPlanVsForecastRisk(FrappeTestCase):
	YEAR = 2026
	MONTH = 6
	PERIOD_KEY = f"{YEAR}_{MONTH:02d}"
	BASE_FORECAST = 100_000
	RISK_FORECAST = 500_000

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for risk exclusion tests")
		cls.expense_account = cls._get_pl_account(cls.company, "Expense")

	def setUp(self):
		self.project = self._make_project()
		self.budget_names = []
		self._seed_project_budget([], self.BASE_FORECAST)
		self._seed_project_budget(
			[{"doc": "Project Risk", "docname": f"RISK-{frappe.generate_hash(length=6)}"}],
			self.RISK_FORECAST,
		)

	def tearDown(self):
		for name in reversed(self.budget_names):
			if frappe.db.exists("Project Budget", name):
				frappe.delete_doc("Project Budget", name, ignore_permissions=True, force=1)
		if frappe.db.exists("Project", self.project.name):
			frappe.delete_doc("Project", self.project.name, ignore_permissions=True, force=1)
		frappe.db.commit()

	def test_raw_budget_loader_excludes_project_risk_dimension_rows(self):
		filters = self._base_filters()
		rows = get_raw_budget_data_for_project(self.project.name, filters)
		account_rows = [row for row in rows if row.get("pb_account") == self.expense_account]
		self.assertTrue(account_rows)
		total_forecast = sum(flt(row.get("forecast")) for row in account_rows)
		self.assertEqual(total_forecast, self.BASE_FORECAST)

	def test_process_project_data_excludes_risk_reserve_amounts(self):
		project_rows = process_project_data(self.project.name, self._base_filters())
		account_rows = [row for row in project_rows if row.get("account") == self.expense_account]
		self.assertEqual(len(account_rows), 1)
		self.assertEqual(flt(account_rows[0].get("forecast")), self.BASE_FORECAST)

	def test_execute_report_excludes_risk_reserve_from_account_forecast(self):
		filters = {
			**self._base_filters(),
			"project": self.project.name,
			"view_type": "forecast_only",
			"show_zero_rows": 1,
		}
		_columns, data = execute(filters)
		expense_row = next(row for row in data if row.get("account") == self.expense_account)
		forecast_col = f"forecast_{self.PERIOD_KEY}"
		self.assertEqual(flt(expense_row.get(forecast_col)), self.BASE_FORECAST)
		self.assertNotEqual(flt(expense_row.get(forecast_col)), self.BASE_FORECAST + self.RISK_FORECAST)

	def _base_filters(self):
		return {
			"company": self.company,
			"from_year": self.YEAR,
			"to_year": self.YEAR,
			"from_month": self.MONTH,
			"to_month": self.MONTH,
			"apply_cc_allocation": 0,
		}

	def _seed_project_budget(self, dimensions, forecast):
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = self.project.name
		doc.pb_account = self.expense_account
		for dimension in dimensions:
			doc.append("project_budget_dimension", dimension)
		doc.append(
			"project_budget_amount",
			{
				"pba_year": self.YEAR,
				"pba_month": self.MONTH,
				"pba_plan": 0,
				"pba_expected": forecast,
			},
		)
		doc.save(ignore_permissions=True)
		self.budget_names.append(doc.name)

	def _make_project(self):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PL-RISK-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L Risk {frappe.generate_hash(length=6)}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	@classmethod
	def _get_pl_account(cls, company, root_type):
		account = frappe.db.get_value(
			"Account",
			{
				"company": company,
				"is_group": 0,
				"report_type": "Profit and Loss",
				"root_type": root_type,
			},
			"name",
		)
		if not account:
			raise AssertionError(f"No {root_type} Profit and Loss account found for test company")
		return account
