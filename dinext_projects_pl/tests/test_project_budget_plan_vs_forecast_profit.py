# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	get_root_financial_nodes,
)


def _profit_row(data):
	for row in data:
		if row.get("is_profit_row"):
			return row
	raise AssertionError("Profit row not found")


class TestProjectBudgetPlanVsForecastProfit(FrappeTestCase):
	YEAR = 2026
	MONTH = 6
	PERIOD_KEY = f"{YEAR}_{MONTH:02d}"
	POSTING_DATE = f"{YEAR}-{MONTH:02d}-15"

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for profit tests")

		cls.income_account = cls._get_pl_account(cls.company, "Income")
		cls.expense_account = cls._get_pl_account(cls.company, "Expense")
		cls.balancing_account = cls._get_balancing_account(cls.company)

	def setUp(self):
		self.projects = [self._make_project(), self._make_project()]
		self.journal_entries = []

	def tearDown(self):
		for name in reversed(self.journal_entries):
			doc = frappe.get_doc("Journal Entry", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)

		for project in reversed(self.projects):
			self._cleanup_project_data(project.name)

		frappe.db.commit()

	def test_profit_without_project_filter_equals_root_income_minus_expense(self):
		self._post_journal(
			self.projects[0].name,
			[
				{"account": self.income_account, "debit": 0, "credit": 2000},
				{"account": self.balancing_account, "debit": 2000, "credit": 0},
			],
		)
		self._post_journal(
			self.projects[1].name,
			[
				{"account": self.expense_account, "debit": 800, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 800},
			],
		)

		filters = {
			"company": self.company,
			"from_year": self.YEAR,
			"to_year": self.YEAR,
			"from_month": self.MONTH,
			"to_month": self.MONTH,
			"show_zero_rows": 1,
			"view_type": "actual_only",
		}

		_columns, data = execute(filters)
		profit = _profit_row(data)

		root_income_nodes, root_expense_nodes = get_root_financial_nodes(data)
		actual_col = f"actual_{self.PERIOD_KEY}"

		total_income = sum(
			flt(next(row for row in data if row.get("account") == account).get(actual_col, 0))
			for account in root_income_nodes
		)
		total_expense = sum(
			flt(next(row for row in data if row.get("account") == account).get(actual_col, 0))
			for account in root_expense_nodes
		)

		self.assertTrue(root_income_nodes)
		self.assertTrue(root_expense_nodes)
		self.assertEqual(flt(profit.get(actual_col)), total_income - total_expense)
		self.assertEqual(flt(profit.get("total_fct")), total_income - total_expense)

	def _post_journal(self, project, accounts):
		import erpnext

		cost_center = erpnext.get_default_cost_center(self.company)
		company_currency = frappe.db.get_value("Company", self.company, "default_currency")
		je = frappe.new_doc("Journal Entry")
		je.company = self.company
		je.posting_date = self.POSTING_DATE
		for line in accounts:
			je.append(
				"accounts",
				{
					"account": line["account"],
					"debit_in_account_currency": line["debit"],
					"credit_in_account_currency": line["credit"],
					"cost_center": cost_center,
					"project": project,
				},
			)
		if company_currency:
			je.multi_currency = 1
		je.insert(ignore_permissions=True)
		je.submit()
		self.journal_entries.append(je.name)

	def _make_project(self):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PL-PROFIT-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L Profit {frappe.generate_hash(length=6)}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	@classmethod
	def _get_pl_account(cls, company, root_type):
		company_currency = frappe.db.get_value("Company", company, "default_currency")
		account = frappe.db.get_value(
			"Account",
			{
				"company": company,
				"is_group": 0,
				"report_type": "Profit and Loss",
				"root_type": root_type,
				"account_currency": company_currency,
			},
			"name",
		)
		if not account:
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

	@classmethod
	def _get_balancing_account(cls, company):
		company_currency = frappe.db.get_value("Company", company, "default_currency")
		account = frappe.db.get_value(
			"Account",
			{"company": company, "account_type": "Bank", "is_group": 0, "account_currency": company_currency},
			"name",
		)
		if not account:
			account = frappe.db.get_value(
				"Account",
				{"company": company, "root_type": "Asset", "is_group": 0, "account_currency": company_currency},
				"name",
			)
		if not account:
			raise AssertionError("No balancing account found for test company")
		return account

	@staticmethod
	def _cleanup_project_data(project_name):
		if frappe.db.exists("Project", project_name):
			frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)
