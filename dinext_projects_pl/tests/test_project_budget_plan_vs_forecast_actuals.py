# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.actual_loader import (
	get_actual_data_simple,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.actual_utils import (
	signed_pl_amount,
)


class TestProjectBudgetPlanVsForecastActuals(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		cls.expense_account = cls._get_pl_account(cls.company, "Expense")
		cls.income_account = cls._get_pl_account(cls.company, "Income")
		cls.balancing_account = cls._get_balancing_account(cls.company)

	def setUp(self):
		self.project = self._make_project()
		self.journal_entries = []

	def tearDown(self):
		for name in reversed(self.journal_entries):
			doc = frappe.get_doc("Journal Entry", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)
		self._cleanup_project_data(self.project.name)

	def test_expense_actual_is_signed_debit_minus_credit(self):
		self._post_journal(
			[
				{"account": self.expense_account, "debit": 1000, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 1000},
			],
			"2026-04-10",
		)
		self._post_journal(
			[
				{"account": self.expense_account, "debit": 0, "credit": 300},
				{"account": self.balancing_account, "debit": 300, "credit": 0},
			],
			"2026-04-20",
		)

		actual = self._get_actual_for_account(self.expense_account, 2026, 4)
		self.assertEqual(actual, 700)

	def test_expense_net_credit_month_is_negative(self):
		self._post_journal(
			[
				{"account": self.expense_account, "debit": 0, "credit": 500},
				{"account": self.balancing_account, "debit": 500, "credit": 0},
			],
			"2026-04-15",
		)

		actual = self._get_actual_for_account(self.expense_account, 2026, 4)
		self.assertEqual(actual, -500)

	def test_income_actual_remains_credit_minus_debit(self):
		self._post_journal(
			[
				{"account": self.income_account, "debit": 0, "credit": 1000},
				{"account": self.balancing_account, "debit": 1000, "credit": 0},
			],
			"2026-04-10",
		)
		self._post_journal(
			[
				{"account": self.income_account, "debit": 300, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 300},
			],
			"2026-04-20",
		)

		actual = self._get_actual_for_account(self.income_account, 2026, 4)
		self.assertEqual(actual, 700)

	def test_signed_pl_amount_matches_gl_convention(self):
		self.assertEqual(signed_pl_amount("Income", 300, 1000), 700)
		self.assertEqual(signed_pl_amount("Income", 1000, 0), -1000)
		self.assertEqual(signed_pl_amount("Expense", 1000, 300), 700)
		self.assertEqual(signed_pl_amount("Expense", 0, 500), -500)

	def test_finance_book_filter_excludes_non_default_book(self):
		default_fb, other_fb = self._ensure_finance_books()
		original_default_fb = frappe.db.get_value("Company", self.company, "default_finance_book")
		frappe.db.set_value("Company", self.company, "default_finance_book", default_fb)

		try:
			self._post_journal(
				[
					{"account": self.expense_account, "debit": 1000, "credit": 0},
					{"account": self.balancing_account, "debit": 0, "credit": 1000},
				],
				"2026-05-10",
				finance_book=default_fb,
			)
			self._post_journal(
				[
					{"account": self.expense_account, "debit": 500, "credit": 0},
					{"account": self.balancing_account, "debit": 0, "credit": 500},
				],
				"2026-05-15",
				finance_book=other_fb,
			)

			actual = self._get_actual_for_account(self.expense_account, 2026, 5)
			self.assertEqual(actual, 1000)
		finally:
			frappe.db.set_value("Company", self.company, "default_finance_book", original_default_fb)

	def _get_actual_for_account(self, account, year, month):
		rows = get_actual_data_simple(
			{
				"company": self.company,
				"project": self.project.name,
				"from_year": year,
				"to_year": year,
				"from_month": month,
				"to_month": month,
			}
		)
		for row in rows:
			if row.get("account") == account:
				return flt(row.get("actual"))
		return 0

	def _post_journal(self, accounts, posting_date, finance_book=None):
		import erpnext

		cost_center = erpnext.get_default_cost_center(self.company)
		company_currency = frappe.db.get_value("Company", self.company, "default_currency")
		je = frappe.new_doc("Journal Entry")
		je.company = self.company
		je.posting_date = posting_date
		if finance_book:
			je.finance_book = finance_book
		for line in accounts:
			je.append(
				"accounts",
				{
					"account": line["account"],
					"debit_in_account_currency": line["debit"],
					"credit_in_account_currency": line["credit"],
					"cost_center": cost_center,
					"project": self.project.name,
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
				"name": f"TEST-PL-ACTUALS-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L Actuals {frappe.generate_hash(length=6)}",
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

	@classmethod
	def _ensure_finance_books(cls):
		default_name = "TEST-PL-ACTUALS-FB-DEFAULT"
		other_name = "TEST-PL-ACTUALS-FB-OTHER"
		for name in (default_name, other_name):
			if not frappe.db.exists("Finance Book", name):
				frappe.get_doc({"doctype": "Finance Book", "finance_book_name": name}).insert(
					ignore_permissions=True
				)
		return default_name, other_name
