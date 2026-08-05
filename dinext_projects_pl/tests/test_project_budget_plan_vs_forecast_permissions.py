# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.permissions import (
	apply_report_project_permissions,
	get_report_project_options,
	get_writable_report_project_names,
	get_writable_report_projects,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
)


class TestProjectBudgetPlanVsForecastPermissions(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for permission tests")

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		super().tearDownClass()

	def setUp(self):
		self.test_user = f"budget_report_perm_{frappe.generate_hash(length=6)}@example.com"
		if not frappe.db.exists("User", self.test_user):
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": self.test_user,
					"first_name": "Budget Report Perm",
					"send_welcome_email": 0,
				}
			)
			user.insert(ignore_permissions=True)

		self.writable_project = self._make_project("WRITABLE")
		self.readonly_project = self._make_project("READONLY")
		self._grant_project_access(self.writable_project.name, write=1)
		self._grant_project_access(self.readonly_project.name, write=0)

	def tearDown(self):
		frappe.set_user("Administrator")
		for project in (self.writable_project, self.readonly_project):
			frappe.share.remove("Project", project.name, self.test_user)
			if frappe.db.exists("Project", project.name):
				frappe.delete_doc("Project", project.name, ignore_permissions=True, force=1)
		frappe.db.commit()

	def test_get_writable_report_projects_requires_write_permission(self):
		frappe.set_user(self.test_user)
		writable = get_writable_report_projects({"company": self.company})
		self.assertIn(self.writable_project.name, writable)
		self.assertNotIn(self.readonly_project.name, writable)

	def test_apply_report_project_permissions_narrows_explicit_filter(self):
		frappe.set_user(self.test_user)
		filters = {
			"company": self.company,
			"project": [self.writable_project.name, self.readonly_project.name],
		}
		apply_report_project_permissions(filters)
		self.assertEqual(filters.get("project"), self.writable_project.name)
		self.assertEqual(filters.get("_report_writable_projects"), [self.writable_project.name])

	def test_get_writable_report_project_names_requires_write_permission(self):
		frappe.set_user(self.test_user)
		writable = get_writable_report_project_names(company=self.company)
		self.assertIn(self.writable_project.name, writable)
		self.assertNotIn(self.readonly_project.name, writable)

	def test_get_report_project_options_shows_project_name(self):
		frappe.set_user(self.test_user)
		options = get_report_project_options(company=self.company)
		writable_option = next(
			(option for option in options if option["value"] == self.writable_project.name),
			None,
		)
		self.assertIsNotNone(writable_option)
		self.assertEqual(writable_option["label"], self.writable_project.project_name)
		self.assertIn(self.writable_project.name, writable_option["description"])
		self.assertNotIn(self.readonly_project.name, [option["value"] for option in options])

	def test_execute_excludes_projects_without_write_permission(self):
		self._seed_project_budget(self.writable_project.name, 1000)
		self._seed_project_budget(self.readonly_project.name, 9000)

		frappe.set_user(self.test_user)
		filters = {
			"company": self.company,
			"from_year": 2026,
			"to_year": 2026,
			"from_month": 6,
			"to_month": 6,
			"view_type": "forecast_only",
			"show_zero_rows": 1,
			"apply_cc_allocation": 0,
		}
		_columns, data = execute(filters)
		expense_account = self._get_expense_account()
		expense_row = next((row for row in data if row.get("account") == expense_account), None)
		self.assertIsNotNone(expense_row)
		self.assertEqual(float(expense_row.get("forecast_2026_06") or 0), 1000.0)

	def _grant_project_access(self, project_name, write):
		frappe.share.add("Project", project_name, self.test_user, read=1, write=write)

	def _make_project(self, suffix):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-BUDGET-PERM-{suffix}-{frappe.generate_hash(length=6)}",
				"project_name": f"Budget Perm {suffix}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	def _seed_project_budget(self, project_name, forecast):
		account = self._get_expense_account()
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = project_name
		doc.pb_account = account
		doc.append(
			"project_budget_amount",
			{
				"pba_year": 2026,
				"pba_month": 6,
				"pba_plan": 0,
				"pba_expected": forecast,
			},
		)
		doc.save(ignore_permissions=True)

	def _get_expense_account(self):
		account = frappe.db.get_value(
			"Account",
			{
				"company": self.company,
				"is_group": 0,
				"report_type": "Profit and Loss",
				"root_type": "Expense",
			},
			"name",
		)
		if not account:
			raise AssertionError("No expense account found for permission tests")
		return account
