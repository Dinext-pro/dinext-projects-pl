# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.project_budget.save import (
	run_save_project_budget_forecast,
)


class TestProjectBudgetSave(FrappeTestCase):
	YEAR = 2026
	MONTH_A = 7
	MONTH_B = 8

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		cls.expense_account = cls._get_expense_account(cls.company)

	def setUp(self):
		self.project = self._make_project()
		self.budget = self._seed_project_budget(
			{
				(self.YEAR, self.MONTH_A): 100,
				(self.YEAR, self.MONTH_B): 200,
			}
		)

	def tearDown(self):
		self._cleanup_project_data(self.project.name)

	def test_two_periods_on_same_budget_persist_in_one_call(self):
		result = run_save_project_budget_forecast(
			{
				"project": self.project.name,
				"changes": [
					self._change(self.MONTH_A, 0),
					self._change(self.MONTH_B, 0),
				],
			}
		)

		self.assertEqual(result["saved"], 2)
		self.assertEqual(self._expected(self.MONTH_A), 0)
		self.assertEqual(self._expected(self.MONTH_B), 0)
		self.assertTrue(self._has_expected(self.MONTH_A))
		self.assertTrue(self._has_expected(self.MONTH_B))

	def test_invalid_change_persists_nothing(self):
		with self.assertRaises(frappe.ValidationError):
			run_save_project_budget_forecast(
				{
					"project": self.project.name,
					"changes": [
						self._change(self.MONTH_A, 0),
						{
							"account": "",
							"dimensions": [],
							"year": self.YEAR,
							"month": self.MONTH_B,
							"value": 0,
						},
					],
				}
			)

		self.assertEqual(self._expected(self.MONTH_A), 100)
		self.assertEqual(self._expected(self.MONTH_B), 200)

	def _change(self, month, value):
		return {
			"account": self.expense_account,
			"dimensions": [],
			"year": self.YEAR,
			"month": month,
			"value": value,
		}

	def _amount_row(self, month):
		doc = frappe.get_doc("Project Budget", self.budget.name)
		for row in doc.project_budget_amount:
			if row.pba_year == self.YEAR and row.pba_month == month:
				return row
		raise AssertionError(f"Period {self.YEAR}-{month} not found")

	def _expected(self, month):
		return flt(self._amount_row(month).pba_expected)

	def _has_expected(self, month):
		return bool(self._amount_row(month).pba_has_expected)

	def test_clear_removes_own_flag_typed_zero_keeps_it(self):
		run_save_project_budget_forecast(
			{"project": self.project.name, "changes": [self._change(self.MONTH_A, None)]}
		)
		self.assertEqual(self._expected(self.MONTH_A), 0)
		self.assertFalse(self._has_expected(self.MONTH_A))

		run_save_project_budget_forecast(
			{"project": self.project.name, "changes": [self._change(self.MONTH_A, 0)]}
		)
		self.assertEqual(self._expected(self.MONTH_A), 0)
		self.assertTrue(self._has_expected(self.MONTH_A))

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
	def _make_project(cls):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PB-SAVE-PROJ-{frappe.generate_hash(length=6)}",
				"project_name": f"PB Save {frappe.generate_hash(length=6)}",
				"company": cls.company,
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	def _seed_project_budget(self, forecast_amounts):
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = self.project.name
		doc.pb_account = self.expense_account
		for (year, month), amount in sorted(forecast_amounts.items()):
			doc.append(
				"project_budget_amount",
				{
					"pba_year": year,
					"pba_month": month,
					"pba_expected": amount,
				},
			)
		doc.save(ignore_permissions=True)
		return doc

	@staticmethod
	def _cleanup_project_data(project_name):
		for name in frappe.get_all(
			"Project Budget",
			filters={"pb_project": project_name},
			pluck="name",
		):
			frappe.delete_doc("Project Budget", name, ignore_permissions=True, force=1)
		if frappe.db.exists("Project", project_name):
			frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)
