# Copyright (c) 2026, Dinext and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.financial_metrics.service import (
	get_project_financial_metrics,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.amounts import (
	can_read_doctype,
	list_readable,
	list_readable_gle_names,
	list_readable_pb_names,
	load_budget_buckets,
	load_gl_fact_buckets,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
	run_get_project_budget_grid,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.save import (
	run_save_project_budget_forecast,
)


class TestListReadableGate(FrappeTestCase):
	def test_list_readable_empty_when_doctype_read_denied(self):
		with patch("frappe.has_permission", return_value=False) as has_permission:
			self.assertFalse(can_read_doctype("Project Budget"))
			self.assertEqual(list_readable("Project Budget", filters={"pb_project": "X"}), [])
			self.assertEqual(list_readable("GL Entry", filters={"project": "X"}), [])
		self.assertEqual(has_permission.call_args_list[0].args, ("Project Budget", "read"))
		self.assertEqual(has_permission.call_args_list[1].args, ("Project Budget", "read"))
		self.assertEqual(has_permission.call_args_list[2].args, ("GL Entry", "read"))

	def test_list_readable_name_helpers_empty_when_doctype_read_denied(self):
		with patch("frappe.has_permission", return_value=False):
			self.assertEqual(list_readable_pb_names("X"), [])
			self.assertEqual(list_readable_gle_names("X", "_Test Company", "2026-01-01", "2026-12-31"), [])

	def test_load_gl_fact_buckets_empty_when_doctype_read_denied(self):
		with patch("frappe.has_permission", return_value=False):
			self.assertEqual(
				load_gl_fact_buckets("_Test Company", "_Test Company", "2026-01-01", "2026-12-31", {}),
				{},
			)


class TestProjectBudgetGridPermissions(FrappeTestCase):
	YEAR = 2026
	MONTH = 6
	PLAN = 1000.0
	FORECAST = 400.0

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for permission tests")
		cls.expense_account = cls._get_expense_account(cls.company)

	def setUp(self):
		self.test_user = f"pb_grid_perm_{frappe.generate_hash(length=6)}@example.com"
		if not frappe.db.exists("User", self.test_user):
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": self.test_user,
					"first_name": "PB Grid Perm",
					"send_welcome_email": 0,
				}
			)
			user.insert(ignore_permissions=True)

		self.project = self._make_project()
		self.budget = self._seed_project_budget()
		frappe.share.add(self.project.doctype, self.project.name, self.test_user, read=1, write=1)

	def tearDown(self):
		frappe.set_user("Administrator")
		if frappe.db.exists(
			"DocShare",
			{"share_doctype": "Project", "share_name": self.project.name, "user": self.test_user},
		):
			frappe.share.remove("Project", self.project.name, self.test_user)
		self._cleanup_project_data(self.project.name)

	def test_consultant_with_project_read_gets_empty_budget_amounts(self):
		frappe.set_user(self.test_user)
		self.assertTrue(frappe.has_permission("Project", "read", self.project.name))
		self.assertFalse(frappe.has_permission("Project Budget", "read"))
		self.assertFalse(frappe.has_permission("GL Entry", "read"))

		self.assertEqual(load_budget_buckets(self.project.name), {})
		self.assertEqual(
			load_gl_fact_buckets(
				self.project.name,
				self.company,
				"2026-01-01",
				"2026-12-31",
				{self.expense_account: "Expense"},
			),
			{},
		)

		grid = run_get_project_budget_grid(
			{
				"project": self.project.name,
				"period_type": "month",
				"show_zero_rows": 1,
			}
		)
		self.assertEqual(self._own_amount_sum(grid.get("rows") or []), 0.0)

		metrics = get_project_financial_metrics(self.project.name, "2026-06-15")
		self.assertTrue(metrics["ready"])
		for track in metrics.get("tracks") or []:
			self.assertEqual(flt(track["values"]["BAC"]), 0.0)
			self.assertEqual(flt(track["values"]["AC"]), 0.0)

	def test_reader_with_permissions_sees_budget_amounts(self):
		frappe.set_user("Administrator")
		buckets = load_budget_buckets(self.project.name)
		amount = self._bucket_amount(buckets, f"plan_{self.YEAR}_{self.MONTH}")
		self.assertEqual(amount, self.PLAN)
		self.assertEqual(
			self._bucket_amount(buckets, f"forecast_{self.YEAR}_{self.MONTH}"),
			self.FORECAST,
		)

		grid = run_get_project_budget_grid(
			{
				"project": self.project.name,
				"period_type": "month",
				"show_zero_rows": 1,
			}
		)
		self.assertGreater(self._own_amount_sum(grid.get("rows") or []), 0.0)

	def test_save_requires_project_budget_write(self):
		frappe.set_user(self.test_user)
		self.assertTrue(frappe.has_permission("Project", "write", self.project.name))
		self.assertFalse(frappe.has_permission("Project Budget", "write"))

		with self.assertRaises(frappe.PermissionError):
			run_save_project_budget_forecast(
				{
					"project": self.project.name,
					"changes": [
						{
							"account": self.expense_account,
							"dimensions": [],
							"year": self.YEAR,
							"month": self.MONTH,
							"value": 1,
						}
					],
				}
			)

		frappe.set_user("Administrator")
		doc = frappe.get_doc("Project Budget", self.budget.name)
		self.assertEqual(flt(doc.project_budget_amount[0].pba_expected), self.FORECAST)

	def _bucket_amount(self, buckets, field):
		account_buckets = buckets.get(self.expense_account) or {}
		for bucket in account_buckets.values():
			if field in bucket:
				return flt(bucket.get(field))
		return 0.0

	@staticmethod
	def _own_amount_sum(rows):
		total = 0.0
		stack = list(rows)
		while stack:
			row = stack.pop()
			stack.extend(row.get("children") or [])
			for key, value in row.items():
				if key.startswith(("own_plan_", "own_forecast_", "own_fact_")):
					total += flt(value)
		return total

	@classmethod
	def _get_expense_account(cls, company):
		account = frappe.db.get_value(
			"Account",
			{
				"company": company,
				"is_group": 0,
				"report_type": "Profit and Loss",
				"root_type": "Expense",
			},
			"name",
		)
		if not account:
			raise AssertionError("No expense account found for permission tests")
		return account

	@classmethod
	def _make_project(cls):
		project = frappe.get_doc(
			{
				"doctype": "Project",
				"name": f"TEST-PB-GRID-PERM-{frappe.generate_hash(length=6)}",
				"project_name": f"PB Grid Perm {frappe.generate_hash(length=6)}",
				"company": cls.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	def _seed_project_budget(self):
		doc = frappe.new_doc("Project Budget")
		doc.pb_project = self.project.name
		doc.pb_account = self.expense_account
		doc.append(
			"project_budget_amount",
			{
				"pba_year": self.YEAR,
				"pba_month": self.MONTH,
				"pba_plan": self.PLAN,
				"pba_expected": self.FORECAST,
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
