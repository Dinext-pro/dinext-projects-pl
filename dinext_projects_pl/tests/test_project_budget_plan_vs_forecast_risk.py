# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from collections import defaultdict
from unittest.mock import patch
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast import (
	periods as report_periods,
)

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.budget_loader import (
	get_accounts,
	get_raw_budget_data_for_project,
	process_project_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.hierarchy import (
	build_hierarchy_for_project,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.risk_utils import (
	DATA_TYPE_WITH_RISK,
	apply_risk_reserves_to_expense_by_column,
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

	def test_raw_budget_loader_includes_project_risk_rows(self):
		filters = self._base_filters()
		rows = get_raw_budget_data_for_project(self.project.name, filters)
		risk_rows = [row for row in rows if row.get("data_type") == DATA_TYPE_WITH_RISK]
		financial_rows = [row for row in rows if row.get("data_type") != DATA_TYPE_WITH_RISK]

		self.assertEqual(len(risk_rows), 1)
		self.assertEqual(flt(risk_rows[0].get("forecast")), self.RISK_FORECAST)
		self.assertTrue(financial_rows)
		self.assertEqual(
			sum(flt(row.get("forecast")) for row in financial_rows),
			self.BASE_FORECAST,
		)

	def test_process_project_data_excludes_risk_from_financial_output(self):
		project_rows = process_project_data(self.project.name, self._base_filters())
		account_rows = [row for row in project_rows if row.get("account") == self.expense_account]
		self.assertEqual(len(account_rows), 1)
		self.assertEqual(flt(account_rows[0].get("forecast")), self.BASE_FORECAST)

	def test_execute_report_excludes_risk_from_account_forecast(self):
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
		self.assertNotEqual(
			flt(expense_row.get(forecast_col)),
			self.BASE_FORECAST + self.RISK_FORECAST,
		)

	def test_execute_report_profit_includes_risk_reserves(self):
		filters = {
			**self._base_filters(),
			"project": self.project.name,
			"view_type": "forecast_only",
			"show_zero_rows": 1,
		}
		_columns, data = execute(filters)
		expense_row = next(row for row in data if row.get("account") == self.expense_account)
		profit_row = next(row for row in data if row.get("is_profit_row"))
		forecast_col = f"forecast_{self.PERIOD_KEY}"

		self.assertEqual(flt(expense_row.get(forecast_col)), self.BASE_FORECAST)
		self.assertEqual(
			flt(profit_row.get(forecast_col)),
			-(self.BASE_FORECAST + self.RISK_FORECAST),
		)
		self.assertEqual(
			flt(profit_row.get("total_exp")),
			-(self.BASE_FORECAST + self.RISK_FORECAST),
		)

	def test_apply_risk_reserves_to_expense_by_column_forecast_only(self):
		expense_by_column = {"forecast_2026_06": 100_000}
		risk_totals = {"2026_06": {"plan": 0, "forecast": 500_000}}
		apply_risk_reserves_to_expense_by_column(
			expense_by_column,
			risk_totals,
			{"view_type": "forecast_only"},
			["forecast_2026_06"],
		)
		self.assertEqual(expense_by_column["forecast_2026_06"], 600_000)

	def test_apply_risk_reserves_quarter_sums_monthly_keys(self):
		expense_by_column = {"forecast_2026_Q2": 100_000}
		risk_totals = {
			"2026_04": {"plan": 0, "forecast": 100_000},
			"2026_05": {"plan": 0, "forecast": 200_000},
			"2026_06": {"plan": 0, "forecast": 200_000},
		}
		apply_risk_reserves_to_expense_by_column(
			expense_by_column,
			risk_totals,
			{"view_type": "forecast_only"},
			["forecast_2026_Q2"],
		)
		self.assertEqual(expense_by_column["forecast_2026_Q2"], 600_000)

	def test_apply_risk_reserves_year_key_sums_monthly_keys(self):
		expense_by_column = {"forecast_2026": 0}
		risk_totals = {"2026_06": {"plan": 0, "forecast": 500_000}}
		apply_risk_reserves_to_expense_by_column(
			expense_by_column,
			risk_totals,
			{"view_type": "forecast_only"},
			["forecast_2026"],
		)
		self.assertEqual(expense_by_column["forecast_2026"], 500_000)

	def test_execute_quarter_granularity_with_risk_does_not_crash(self):
		filters = {
			**self._base_filters(),
			"project": self.project.name,
			"view_type": "forecast_actual",
			"period_granularity": "quarter",
			"from_month": 1,
			"to_month": 12,
			"show_zero_rows": 1,
			"show_zero_columns": 1,
			"show_plan": 1,
		}
		# This scenario needs Q3 to remain within the forecast horizon.
		with patch.object(report_periods, "today", return_value=f"{self.YEAR}-07-01"):
			_columns, data = execute(filters)
		fieldnames = [col.get("fieldname") for col in _columns]
		self.assertIn("forecast_2026_Q3", fieldnames)
		profit_row = next(row for row in data if row.get("is_profit_row"))
		self.assertIn("forecast_2026_Q3", profit_row)

	def test_risk_on_leaf_does_not_roll_up_to_parent_account(self):
		"""Risk reserves stay off the CoA rollup (unlike task aggregation)."""
		child_account = self._get_leaf_expense_under_root()
		if not child_account:
			self.skipTest("No expense group/leaf pair in _Test Company chart")

		# setUp seeds expense_account; drop it so parent rollup reflects only child data.
		for name in list(self.budget_names):
			if frappe.db.exists("Project Budget", name):
				frappe.delete_doc("Project Budget", name, ignore_permissions=True, force=1)
		self.budget_names.clear()
		frappe.db.commit()

		parent_account = frappe.db.get_value("Account", child_account, "parent_account")
		self._seed_on_account(child_account, [], self.BASE_FORECAST)
		self._seed_on_account(
			child_account,
			[{"doc": "Project Risk", "docname": f"RISK-{frappe.generate_hash(length=6)}"}],
			self.RISK_FORECAST,
		)

		filters = self._base_filters()
		project_rows = process_project_data(self.project.name, filters)
		accounts = get_accounts(filters)
		parent_children_map = defaultdict(list)
		for acc in accounts:
			parent_children_map[acc.parent_account or None].append(acc)

		hierarchy = build_hierarchy_for_project(project_rows, accounts, parent_children_map)
		period = self.PERIOD_KEY

		child_forecast = flt(hierarchy[child_account]["data"][period]["forecast"])
		parent_forecast = flt(hierarchy[parent_account]["data"][period]["forecast"])

		self.assertEqual(child_forecast, self.BASE_FORECAST)
		self.assertEqual(parent_forecast, self.BASE_FORECAST)
		self.assertNotEqual(parent_forecast, self.BASE_FORECAST + self.RISK_FORECAST)

	def _seed_on_account(self, account, dimensions, forecast):
		self._seed_project_budget(dimensions, forecast, account=account)

	def _get_leaf_expense_under_root(self):
		groups = frappe.get_all(
			"Account",
			filters={
				"company": self.company,
				"root_type": "Expense",
				"is_group": 1,
				"disabled": 0,
			},
			fields=["name"],
			limit=1,
		)
		if not groups:
			return None
		children = frappe.get_all(
			"Account",
			filters={
				"company": self.company,
				"parent_account": groups[0].name,
				"is_group": 0,
				"disabled": 0,
			},
			fields=["name"],
			limit=1,
		)
		return children[0].name if children else None

	def _base_filters(self):
		return {
			"company": self.company,
			"from_year": self.YEAR,
			"to_year": self.YEAR,
			"from_month": self.MONTH,
			"to_month": self.MONTH,
			"apply_cc_allocation": 0,
		}

	def _seed_project_budget(self, dimensions, forecast, account=None):
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = self.project.name
		doc.pb_account = account or self.expense_account
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
		if any(dimension.get("doc") == "Project Risk" for dimension in dimensions):
			# The report recognizes this semantic tag; its optional DocType is not
			# installed on the isolated PL CI site.
			doc.flags.ignore_links = True
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
