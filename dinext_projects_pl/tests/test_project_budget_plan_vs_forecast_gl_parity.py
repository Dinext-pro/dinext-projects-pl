# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt
from frappe.utils.nestedset import get_descendants_of

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	get_data,
)
from erpnext.accounts.doctype.account.test_account import create_account


def gl_subtree_signed(project, account, start_date, end_date, company):
	"""Signed P&L subtree total from GL Entry (Income/Expense), default finance book filter."""
	descendants = get_descendants_of("Account", account, ignore_permissions=True) or []
	accounts = list({account, *descendants})
	company_fb = frappe.get_cached_value("Company", company, "default_finance_book")

	fb_condition = "(gle.finance_book IN (%(company_fb)s, '') OR gle.finance_book IS NULL)"
	if not company_fb:
		fb_condition = "(gle.finance_book IN ('') OR gle.finance_book IS NULL)"

	row = frappe.db.sql(
		f"""
		SELECT
			ROUND(SUM(
				CASE
					WHEN a.root_type = 'Income' THEN gle.credit - gle.debit
					WHEN a.root_type = 'Expense' THEN gle.debit - gle.credit
					ELSE gle.debit - gle.credit
				END
			), 0) AS amount
		FROM `tabGL Entry` gle
		INNER JOIN `tabAccount` a ON gle.account = a.name
		WHERE gle.company = %(company)s
			AND gle.project = %(project)s
			AND gle.posting_date BETWEEN %(start_date)s AND %(end_date)s
			AND gle.is_cancelled = 0
			AND gle.account IN %(accounts)s
			AND {fb_condition}
		""",
		{
			"company": company,
			"project": project,
			"start_date": start_date,
			"end_date": end_date,
			"accounts": tuple(accounts),
			"company_fb": company_fb or "",
		},
		as_dict=1,
	)
	return flt(row[0].amount if row else 0)


def report_actual(filters, account, period_key):
	"""Actual cell from report get_data() after hierarchy rollup."""
	for row in get_data(filters):
		if row.get("account") == account:
			return flt(row.get(f"actual_{period_key}", 0))
	return 0


class TestProjectBudgetPlanVsForecastGLParity(FrappeTestCase):
	YEAR = 2026
	MONTH = 4
	PERIOD_KEY = f"{YEAR}_{MONTH:02d}"
	POSTING_DATE = f"{YEAR}-{MONTH:02d}-15"
	START_DATE = f"{YEAR}-{MONTH:02d}-01"
	END_DATE = f"{YEAR}-{MONTH:02d}-30"

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = "_Test Company"
		if not frappe.db.exists("Company", cls.company):
			raise AssertionError("ERPNext _Test Company is required for GL parity tests")

		cls.balancing_account = cls._get_balancing_account(cls.company)
		cls.expense_parent = cls._get_expense_group_parent(cls.company)
		cls.leaf_expense_account = cls._get_pl_leaf_account(cls.company, "Expense")

	@classmethod
	def tearDownClass(cls):
		frappe.db.commit()
		super().tearDownClass()

	def setUp(self):
		self.project = self._make_project()
		self.journal_entries = []
		self.test_accounts = []
		self.raw_gl_entries = []

	def tearDown(self):
		for gle_name in reversed(self.raw_gl_entries):
			if frappe.db.exists("GL Entry", gle_name):
				frappe.delete_doc("GL Entry", gle_name, ignore_permissions=True, force=1)

		for name in reversed(self.journal_entries):
			doc = frappe.get_doc("Journal Entry", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)

		self._delete_gl_for_accounts(self.test_accounts)

		for account_name in reversed(self.test_accounts):
			if frappe.db.exists("Account", account_name):
				frappe.delete_doc("Account", account_name, ignore_permissions=True, force=1)

		self._cleanup_project_data(self.project.name)
		frappe.db.commit()

	def _report_filters(self):
		return {
			"company": self.company,
			"project": self.project.name,
			"from_year": self.YEAR,
			"to_year": self.YEAR,
			"from_month": self.MONTH,
			"to_month": self.MONTH,
			"show_zero_rows": 1,
			"view_type": "forecast_actual",
		}

	def test_leaf_account_report_matches_gl_subtree(self):
		self._post_journal(
			[
				{"account": self.leaf_expense_account, "debit": 1000, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 1000},
			],
			self.POSTING_DATE,
		)
		self._post_journal(
			[
				{"account": self.leaf_expense_account, "debit": 0, "credit": 300},
				{"account": self.balancing_account, "debit": 300, "credit": 0},
			],
			self.POSTING_DATE,
		)

		filters = self._report_filters()
		gl_amount = gl_subtree_signed(
			self.project.name,
			self.leaf_expense_account,
			self.START_DATE,
			self.END_DATE,
			self.company,
		)
		report_amount = report_actual(filters, self.leaf_expense_account, self.PERIOD_KEY)

		self.assertEqual(gl_amount, 700)
		self.assertEqual(report_amount, gl_amount)

	def test_group_account_children_only_matches_gl_subtree(self):
		group, child_a, child_b = self._make_expense_group_with_children()

		self._post_journal(
			[
				{"account": child_a, "debit": 400, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 400},
			],
			self.POSTING_DATE,
		)
		self._post_journal(
			[
				{"account": child_b, "debit": 250, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 250},
			],
			self.POSTING_DATE,
		)

		filters = self._report_filters()
		gl_amount = gl_subtree_signed(
			self.project.name, group, self.START_DATE, self.END_DATE, self.company
		)
		report_amount = report_actual(filters, group, self.PERIOD_KEY)

		self.assertEqual(gl_amount, 650)
		self.assertEqual(report_amount, gl_amount)

	def test_group_account_own_gl_plus_children_matches_gl_subtree(self):
		"""Regression: actual rollup must be own + children, not own-only when has_own_data."""
		group, child_a, child_b = self._make_expense_group_with_children()

		self._post_journal(
			[
				{"account": child_a, "debit": 300, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 300},
			],
			self.POSTING_DATE,
		)
		self._post_journal(
			[
				{"account": child_b, "debit": 200, "credit": 0},
				{"account": self.balancing_account, "debit": 0, "credit": 200},
			],
			self.POSTING_DATE,
		)
		self._insert_raw_gl(group, debit=150, credit=0)

		filters = self._report_filters()
		gl_amount = gl_subtree_signed(
			self.project.name, group, self.START_DATE, self.END_DATE, self.company
		)
		report_amount = report_actual(filters, group, self.PERIOD_KEY)

		self.assertEqual(gl_amount, 650)
		self.assertEqual(report_amount, gl_amount)

	def _make_expense_group_with_children(self):
		suffix = frappe.generate_hash(length=6)
		group = create_account(
			account_name=f"TEST PL Group {suffix}",
			parent_account=self.expense_parent,
			company=self.company,
			is_group=1,
		)
		child_a = create_account(
			account_name=f"TEST PL Child A {suffix}",
			parent_account=group,
			company=self.company,
			is_group=0,
		)
		child_b = create_account(
			account_name=f"TEST PL Child B {suffix}",
			parent_account=group,
			company=self.company,
			is_group=0,
		)
		self.test_accounts.extend([group, child_a, child_b])
		return group, child_a, child_b

	def _insert_raw_gl(self, account, debit, credit):
		"""Direct GL row for group parent own amount (JE cannot target group accounts)."""
		import erpnext
		from erpnext.accounts.utils import get_fiscal_year

		cost_center = erpnext.get_default_cost_center(self.company)
		fiscal_year = get_fiscal_year(self.POSTING_DATE, company=self.company)[0]
		voucher_no = f"TEST-GL-{frappe.generate_hash(length=8)}"
		gle_name = frappe.generate_hash(length=10)

		frappe.db.sql(
			"""
			INSERT INTO `tabGL Entry` (
				name, posting_date, account, debit, credit,
				debit_in_account_currency, credit_in_account_currency,
				company, fiscal_year, voucher_type, voucher_no,
				cost_center, project, is_cancelled, owner, creation, modified, modified_by
			) VALUES (
				%(name)s, %(posting_date)s, %(account)s, %(debit)s, %(credit)s,
				%(debit)s, %(credit)s,
				%(company)s, %(fiscal_year)s, 'Journal Entry', %(voucher_no)s,
				%(cost_center)s, %(project)s, 0, %(owner)s, NOW(), NOW(), %(owner)s
			)
			""",
			{
				"name": gle_name,
				"posting_date": self.POSTING_DATE,
				"account": account,
				"debit": debit,
				"credit": credit,
				"company": self.company,
				"fiscal_year": fiscal_year,
				"voucher_no": voucher_no,
				"cost_center": cost_center,
				"project": self.project.name,
				"owner": frappe.session.user,
			},
		)
		self.raw_gl_entries.append(gle_name)

	def _post_journal(self, accounts, posting_date):
		import erpnext

		cost_center = erpnext.get_default_cost_center(self.company)
		company_currency = frappe.db.get_value("Company", self.company, "default_currency")
		je = frappe.new_doc("Journal Entry")
		je.company = self.company
		je.posting_date = posting_date
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
				"name": f"TEST-PL-GL-PARITY-{frappe.generate_hash(length=6)}",
				"project_name": f"P&L GL Parity {frappe.generate_hash(length=6)}",
				"company": self.company,
				"expected_start_date": "2026-01-01",
				"expected_end_date": "2026-12-31",
			}
		)
		project.insert(ignore_permissions=True, ignore_mandatory=True)
		return project

	@classmethod
	def _get_expense_group_parent(cls, company):
		parent = frappe.db.get_value(
			"Account",
			{
				"company": company,
				"is_group": 1,
				"root_type": "Expense",
				"report_type": "Profit and Loss",
			},
			"name",
			order_by="lft desc",
		)
		if not parent:
			raise AssertionError("No Expense group account found for test company")
		return parent

	@classmethod
	def _get_pl_leaf_account(cls, company, root_type):
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
			raise AssertionError(f"No {root_type} Profit and Loss leaf account found for test company")
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
	def _delete_gl_for_accounts(account_names):
		for account in account_names:
			for gle_name in frappe.get_all("GL Entry", filters={"account": account}, pluck="name"):
				frappe.delete_doc("GL Entry", gle_name, ignore_permissions=True, force=1)

	@staticmethod
	def _cleanup_project_data(project_name):
		if frappe.db.exists("Project", project_name):
			frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)
