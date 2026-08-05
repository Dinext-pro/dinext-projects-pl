# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.actual_loader import (
	get_actual_data_simple,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.allocation import (
	calculate_allocation_for_month,
)
from erpnext.accounts.doctype.cost_center.test_cost_center import create_cost_center


class TestProjectBudgetPlanVsForecastAllocationActuals(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		cls.company_abbr = frappe.db.get_value("Company", cls.company, "abbr")
		cls.expense_account = cls._get_pl_account(cls.company, "Expense")
		cls.balancing_account = cls._get_balancing_account(cls.company)

		cls._ensure_cost_center("TEST-PL-ALLOC-MAIN")
		cls._ensure_cost_center("TEST-PL-ALLOC-CHILD-A")
		cls._ensure_cost_center("TEST-PL-ALLOC-CHILD-B")

		cls.main_cc = cls._cc_name("TEST-PL-ALLOC-MAIN")
		cls.child_cc_a = cls._cc_name("TEST-PL-ALLOC-CHILD-A")
		cls.child_cc_b = cls._cc_name("TEST-PL-ALLOC-CHILD-B")

	@classmethod
	def _cc_name(cls, cost_center_name):
		return f"{cost_center_name} - {cls.company_abbr}"

	@classmethod
	def _ensure_cost_center(cls, cost_center_name):
		cc_name = cls._cc_name(cost_center_name)
		if not frappe.db.exists("Cost Center", cc_name):
			create_cost_center(cost_center_name=cost_center_name, company=cls.company)

	def setUp(self):
		self.journal_entries = []
		self.allocations = []
		self._ensure_cost_center_allocation(
			self.main_cc,
			{self.child_cc_a: 60, self.child_cc_b: 40},
		)

	def tearDown(self):
		for name in reversed(self.allocations):
			doc = frappe.get_doc("Cost Center Allocation", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Cost Center Allocation", name, ignore_permissions=True, force=1)

		for name in reversed(self.journal_entries):
			doc = frappe.get_doc("Journal Entry", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)

		if getattr(self, "project", None):
			self._cleanup_project_data(self.project.name)

	def test_apply_cc_allocation_matches_allocation_formula(self):
		self.project = self._make_project_with_cc_history(self.main_cc)
		self._post_journal(
			[
				{"account": self.expense_account, "debit": 1000, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 1000},
			],
			"2026-06-10",
			cost_center=self.main_cc,
		)

		expected = calculate_allocation_for_month(
			project=self.project.name,
			year=2026,
			month=6,
			total_amount=1000,
			cost_center_filter=self.child_cc_a,
			apply_allocation=1,
		)
		self.assertEqual(expected, 600)

		actual = self._get_actual(
			cost_center=self.child_cc_a,
			apply_cc_allocation=1,
			year=2026,
			month=6,
		)
		self.assertEqual(actual, expected)

	def test_apply_cc_allocation_disabled_uses_direct_gl_cost_center(self):
		self.project = self._make_project_with_cc_history(None)
		self._post_journal(
			[
				{"account": self.expense_account, "debit": 1000, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 1000},
			],
			"2026-06-10",
			cost_center=self.main_cc,
		)

		actual_child = self._get_actual(
			cost_center=self.child_cc_a,
			apply_cc_allocation=0,
			year=2026,
			month=6,
		)
		self.assertEqual(actual_child, 600)

		actual_with_allocation = self._get_actual(
			cost_center=self.child_cc_a,
			apply_cc_allocation=1,
			year=2026,
			month=6,
		)
		self.assertEqual(actual_with_allocation, 0)

		actual_main = self._get_actual(
			cost_center=self.main_cc,
			apply_cc_allocation=0,
			year=2026,
			month=6,
		)
		self.assertEqual(actual_main, 0)

	def _get_actual(self, cost_center, apply_cc_allocation, year, month):
		rows = get_actual_data_simple(
			{
				"company": self.company,
				"project": self.project.name,
				"cost_center": cost_center,
				"apply_cc_allocation": apply_cc_allocation,
				"from_year": year,
				"to_year": year,
				"from_month": month,
				"to_month": month,
			}
		)
		for row in rows:
			if row.get("account") == self.expense_account:
				return flt(row.get("actual"))
		return 0

	def _ensure_cost_center_allocation(self, main_cost_center, allocation_percentages):
		doc = frappe.new_doc("Cost Center Allocation")
		doc.main_cost_center = main_cost_center
		doc.company = self.company
		doc.valid_from = "2026-01-01"
		for cc, percentage in allocation_percentages.items():
			doc.append("allocation_percentages", {"cost_center": cc, "percentage": percentage})
		doc.insert(ignore_permissions=True)
		doc.submit()
		self.allocations.append(doc.name)

	def _make_project_with_cc_history(self, cost_center):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PL-ALLOC-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L Alloc Actuals {frappe.generate_hash(length=6)}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		if cost_center and frappe.get_meta("Project").has_field("custom_cost_center_table"):
			project.append(
				"custom_cost_center_table",
				{
					"cct_valid_from": "2026-01-01",
					"cct_cost_center": cost_center,
				},
			)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	def _post_journal(self, accounts, posting_date, cost_center=None, finance_book=None):
		company_currency = frappe.db.get_value("Company", self.company, "default_currency")
		if not cost_center:
			import erpnext

			cost_center = erpnext.get_default_cost_center(self.company)

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
				{
					"company": company,
					"root_type": "Asset",
					"is_group": 0,
					"account_currency": company_currency,
				},
				"name",
			)
		if not account:
			raise AssertionError("No balancing account found for test company")
		return account

	@staticmethod
	def _cleanup_project_data(project_name):
		if frappe.db.exists("Project", project_name):
			frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)
