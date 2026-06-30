# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.budget_loader import (
	get_accounts,
	get_raw_budget_data_for_projects,
	preload_project_budget_context,
	process_project_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.hierarchy import (
	build_hierarchy_for_project,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
	get_budget_details,
	get_data,
	get_profit_details,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	get_root_financial_nodes,
	get_root_financial_nodes_from_accounts,
)


class TestProjectBudgetPlanVsForecastDrilldown(FrappeTestCase):
	YEAR = 2026
	MONTH = 6
	PERIOD_KEY = f"{YEAR}_{MONTH:02d}"

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for drill-down tests")

		cls.income_account = cls._get_pl_account(cls.company, "Income")
		cls.expense_account = cls._get_pl_account(cls.company, "Expense")

	def setUp(self):
		self.projects = []
		self.budget_names = []

	def tearDown(self):
		for name in reversed(self.budget_names):
			if frappe.db.exists("Project Budget", name):
				frappe.delete_doc("Project Budget", name, ignore_permissions=True, force=1)
		for project in reversed(self.projects):
			if frappe.db.exists("Project", project.name):
				frappe.delete_doc("Project", project.name, ignore_permissions=True, force=1)
		frappe.db.commit()

	def test_root_financial_nodes_from_accounts_matches_report(self):
		project = self._make_project()
		self._seed_budget(project.name, self.expense_account, forecast=5_000)

		filters = {
			**self._base_filters(view_type="forecast_only"),
			"project": project.name,
			"show_zero_rows": 1,
		}
		data = get_data(filters)
		from_report = get_root_financial_nodes(data)
		from_accounts = get_root_financial_nodes_from_accounts(get_accounts(filters))
		self.assertEqual(from_accounts, from_report)

	def test_preload_context_without_projects_still_loads_accounts(self):
		filters = self._base_filters(view_type="forecast_only")
		context = preload_project_budget_context(filters, [])
		self.assertTrue(context["accounts"])
		self.assertTrue(context["parent_children_map"])

	def test_preload_context_batches_multiple_projects(self):
		project_a = self._make_project()
		project_b = self._make_project()
		self._seed_budget(project_a.name, self.expense_account, forecast=10_000)
		self._seed_budget(project_b.name, self.expense_account, forecast=20_000)

		filters = self._base_filters(view_type="forecast_only")
		context = preload_project_budget_context(
			filters, [project_a.name, project_b.name]
		)

		self.assertIn("raw_by_project", context)
		self.assertIn("task_hierarchies", context)
		self.assertIn("accounts", context)
		self.assertIn("parent_children_map", context)
		self.assertTrue(context["raw_by_project"].get(project_a.name))
		self.assertTrue(context["raw_by_project"].get(project_b.name))

		batch_rows = get_raw_budget_data_for_projects(
			[project_a.name, project_b.name], filters
		)
		self.assertGreaterEqual(len(batch_rows), 2)

	def test_budget_drilldown_matches_batch_processing(self):
		project_a = self._make_project()
		project_b = self._make_project()
		self._seed_budget(project_a.name, self.expense_account, forecast=15_000)
		self._seed_budget(project_b.name, self.expense_account, forecast=25_000)

		filters = self._base_filters(view_type="forecast_only")
		drill_rows = get_budget_details(
			account=self.expense_account,
			year=self.YEAR,
			month=self.MONTH,
			data_type="forecast",
			company=self.company,
			apply_cc_allocation=0,
		)
		drill_by_project = {row["project"]: flt(row["amount"]) for row in drill_rows}

		context = preload_project_budget_context(
			filters, [project_a.name, project_b.name]
		)
		expected = {}
		for project in (project_a.name, project_b.name):
			project_raw = process_project_data(
				project,
				filters,
				raw_budget_data=context["raw_by_project"].get(project, []),
				task_hierarchy=context["task_hierarchies"].get(project, {}),
			)
			hierarchy = build_hierarchy_for_project(
				project_raw,
				context["accounts"],
				context["parent_children_map"],
			)
			period_data = hierarchy.get(self.expense_account, {}).get("data", {}).get(
				self.PERIOD_KEY, {}
			)
			amount = flt(period_data.get("forecast"))
			if amount:
				expected[project] = amount

		self.assertEqual(drill_by_project.get(project_a.name), expected.get(project_a.name))
		self.assertEqual(drill_by_project.get(project_b.name), expected.get(project_b.name))

	def test_budget_drilldown_matches_report_cell(self):
		project = self._make_project()
		forecast = 42_000
		self._seed_budget(project.name, self.expense_account, forecast=forecast)

		filters = {
			**self._base_filters(view_type="forecast_only"),
			"project": project.name,
			"show_zero_rows": 1,
		}
		_columns, data = execute(filters)
		report_row = next(row for row in data if row.get("account") == self.expense_account)
		report_amount = flt(report_row.get(f"forecast_{self.PERIOD_KEY}"))

		drill_rows = get_budget_details(
			account=self.expense_account,
			year=self.YEAR,
			month=self.MONTH,
			data_type="forecast",
			project=project.name,
			company=self.company,
			apply_cc_allocation=0,
		)
		drill_total = sum(flt(row.get("amount")) for row in drill_rows)
		self.assertEqual(drill_total, forecast)
		self.assertEqual(report_amount, forecast)

	def test_profit_drilldown_forecast_equals_income_minus_expense(self):
		project = self._make_project()
		income_forecast = 100_000
		expense_forecast = 35_000
		self._seed_budget(project.name, self.income_account, forecast=income_forecast)
		self._seed_budget(project.name, self.expense_account, forecast=expense_forecast)

		rows = get_profit_details(
			year=self.YEAR,
			month=self.MONTH,
			data_type="forecast",
			project=project.name,
			company=self.company,
			apply_cc_allocation=0,
		)
		self.assertEqual(len(rows), 1)
		row = rows[0]
		self.assertEqual(row["project"], project.name)
		self.assertEqual(flt(row["income"]), income_forecast)
		self.assertEqual(flt(row["expense"]), expense_forecast)
		self.assertEqual(flt(row["profit"]), income_forecast - expense_forecast)

	def _base_filters(self, view_type="forecast_only"):
		return {
			"company": self.company,
			"from_year": self.YEAR,
			"to_year": self.YEAR,
			"from_month": self.MONTH,
			"to_month": self.MONTH,
			"view_type": view_type,
			"apply_cc_allocation": 0,
		}

	def _seed_budget(self, project, account, forecast=0, plan=0):
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = project
		doc.pb_account = account
		doc.append(
			"project_budget_amount",
			{
				"pba_year": self.YEAR,
				"pba_month": self.MONTH,
				"pba_plan": plan,
				"pba_expected": forecast,
			},
		)
		doc.save(ignore_permissions=True)
		self.budget_names.append(doc.name)

	def _make_project(self):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PL-DRILL-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L Drill {frappe.generate_hash(length=6)}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		self.projects.append(project)
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
