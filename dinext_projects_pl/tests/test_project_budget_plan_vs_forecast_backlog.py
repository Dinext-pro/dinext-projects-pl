# Copyright (c) 2026, Dinext and Contributors
"""Backlog QA cases from .issues/ISS-2026-00418/test-cases.md (Phase 2–3 remainder)."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.allocation import (
	calculate_allocation_for_month,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.export_xlsx import (
	build_grouped_xlsx_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.permissions import (
	apply_report_project_permissions,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
	get_budget_details,
	get_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	apply_accumulated_presentation,
)
from dinext_projects_pl.tests.fixtures.bvf_report_seed import (
	PROJECT_A,
	PROJECT_B,
	reset_bvf_report_seed,
	seed_bvf_report_seed,
)
from dinext_projects_pl.tests.test_project_budget_plan_vs_forecast_gl_parity import (
	gl_subtree_signed,
)


class TestProjectBudgetPlanVsForecastBacklog(FrappeTestCase):
	"""Remaining TC-CC/GL/ACC and Phase 3 matrix cases on BVF seed."""

	PERIOD_APR = "2026_04"
	APR_START = "2026-04-01"
	APR_END = "2026-04-30"
	NET_EXPENSE_APR = 800

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.seed = seed_bvf_report_seed()
		cls.company = cls.seed["company"]
		cls.project = cls.seed["projects"]["a"]
		cls.project_b = cls.seed["projects"]["b"]
		cls.expense_account = cls.seed["expense_account"]
		cls.income_account = cls.seed["income_account"]
		cls.child_cc_a = cls.seed["cost_centers"]["a"]
		cls.business_area_a = cls.seed["business_areas"]["a"]
		cls.portfolio = cls.seed["project_portfolio"]

	@classmethod
	def tearDownClass(cls):
		reset_bvf_report_seed()
		frappe.db.commit()
		super().tearDownClass()

	def _base_filters(self, **overrides):
		filters = {
			"company": self.company,
			"project": self.project,
			"from_year": 2026,
			"to_year": 2026,
			"from_month": 4,
			"to_month": 6,
			"apply_cc_allocation": 1,
		}
		filters.update(overrides)
		return filters

	def _cell(self, filters, account, field_prefix, period_key):
		for row in get_data(filters):
			if row.get("account") == account:
				return flt(row.get(f"{field_prefix}_{period_key}", 0))
		return 0

	def test_cc08_cc_and_business_area_filter_combined(self):
		"""TC-CC-08: CC Child-A + BA-A → 800 * 60% * 70% = 336."""
		filters = self._base_filters(
			cost_center=self.child_cc_a,
			business_area=self.business_area_a,
			view_type="actual_only",
			from_month=4,
			to_month=4,
		)
		actual = self._cell(filters, self.expense_account, "actual", self.PERIOD_APR)
		expected = calculate_allocation_for_month(
			project=self.project,
			year=2026,
			month=4,
			total_amount=self.NET_EXPENSE_APR,
			cost_center_filter=self.child_cc_a,
			business_area_filter=self.business_area_a,
			apply_allocation=1,
		)
		self.assertEqual(expected, 336)
		self.assertEqual(actual, expected)

	def test_gl01_budget_drilldown_matches_report_forecast_cell(self):
		"""TC-GL-01 (drill API): get_budget_details total = report forecast cell."""
		filters = self._base_filters(
			view_type="forecast_only",
			from_month=6,
			to_month=6,
		)
		filters.pop("cost_center", None)
		_columns, data = execute(filters)
		report_row = next(row for row in data if row.get("account") == self.expense_account)
		report_amount = flt(report_row.get("forecast_2026_06"))

		drill_rows = get_budget_details(
			account=self.expense_account,
			year=2026,
			month=6,
			data_type="forecast",
			project=self.project,
			company=self.company,
			apply_cc_allocation=1,
		)
		drill_total = sum(flt(row.get("amount")) for row in drill_rows)
		self.assertEqual(drill_total, report_amount)
		self.assertEqual(report_amount, 330)

	def test_gl04_total_fct_equals_sum_of_display_periods(self):
		"""TC-GL-04: total_exp_fct in period mode = sum Apr–Jun display columns."""
		filters = self._base_filters(
			view_type="forecast_actual",
			show_plan=0,
		)
		filters.pop("cost_center", None)
		_columns, data = execute(filters)
		expense_row = next(row for row in data if row.get("account") == self.expense_account)
		period_sum = sum(
			flt(expense_row.get(f"actual_2026_{month:02d}", 0))
			for month in (4, 5, 6)
		)
		self.assertEqual(flt(expense_row.get("total_exp_fct")), period_sum)

	def test_gl06_finance_book_excluded_from_actual_on_bvf(self):
		"""TC-GL-06: non-default finance book JE excluded from report actual."""
		default_fb, other_fb = self._ensure_finance_books()
		original = frappe.db.get_value("Company", self.company, "default_finance_book")
		frappe.db.set_value("Company", self.company, "default_finance_book", default_fb)

		try:
			self._post_journal("2026-06-10", 600, finance_book=default_fb)
			self._post_journal("2026-06-15", 250, finance_book=other_fb)
			filters = self._base_filters(
				view_type="actual_only",
				from_month=6,
				to_month=6,
			)
			actual = self._cell(filters, self.expense_account, "actual", "2026_06")
			gl_default = gl_subtree_signed(
				self.project,
				self.expense_account,
				"2026-06-01",
				"2026-06-30",
				self.company,
			)
			self.assertEqual(actual, 600)
			self.assertEqual(gl_default, 600)
		finally:
			frappe.db.set_value("Company", self.company, "default_finance_book", original)
			for name in getattr(self, "_extra_journals", []):
				doc = frappe.get_doc("Journal Entry", name)
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)
			self._extra_journals = []

	def test_gl07_draft_merge_increases_actual_without_gl(self):
		"""TC-GL-07: draft merge path adds actual; GL subtree for future month stays 0."""
		from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.actual_loader import (
			get_actual_data_simple,
			merge_actual_and_draft,
		)

		draft_amount = 999
		filters = self._base_filters(
			view_type="actual_only",
			from_month=7,
			to_month=7,
		)
		filters.pop("cost_center", None)

		actual_rows = get_actual_data_simple({**filters, "include_future_actual": 0})
		draft_rows = [
			{
				"account": self.expense_account,
				"year": 2026,
				"month": 7,
				"actual": draft_amount,
			}
		]
		merged = merge_actual_and_draft(actual_rows, draft_rows)

		jul_actual = 0
		for row in merged:
			if row.get("account") == self.expense_account and row.get("month") == 7:
				jul_actual = flt(row.get("actual"))
				break

		gl_amount = gl_subtree_signed(
			self.project,
			self.expense_account,
			"2026-07-01",
			"2026-07-31",
			self.company,
		)

		self.assertEqual(gl_amount, 0)
		self.assertEqual(jul_actual, draft_amount)
		with_draft = self._cell({**filters, "include_future_actual": 1}, self.expense_account, "actual", "2026_07")
		self.assertGreaterEqual(with_draft, 0)

	def test_acc07_accumulated_actual_total_fct_matches_last_period(self):
		"""TC-ACC-07: accumulated actual_only — total_fct equals last running actual column."""
		filters = self._base_filters(
			view_type="actual_only",
			from_month=4,
			to_month=5,
		)
		filters.pop("cost_center", None)
		columns, period_data = execute(filters)
		acc_data = apply_accumulated_presentation(
			period_data, columns, {**filters, "accumulated_values": 1}
		)
		expense_row = next(row for row in acc_data if row.get("account") == self.expense_account)
		self.assertEqual(flt(expense_row.get("actual_2026_04")), 800)
		self.assertEqual(flt(expense_row.get("actual_2026_05")), 1200)
		self.assertEqual(flt(expense_row.get("total_fct")), 1200)

	def test_acc06_quarter_granularity_accumulated_on_real_seed(self):
		"""TC-ACC-06: quarter + accumulated plan on real BVF budget."""
		filters = self._base_filters(
			view_type="plan_only",
			show_plan=1,
			period_granularity="quarter",
			from_month=4,
			to_month=6,
		)
		filters.pop("cost_center", None)
		columns, period_data = execute(filters)
		acc_data = apply_accumulated_presentation(
			period_data, columns, {**filters, "accumulated_values": 1}
		)
		expense_row = next(row for row in acc_data if row.get("account") == self.expense_account)
		self.assertEqual(flt(expense_row.get("plan_2026_Q2")), 600)
		self.assertEqual(flt(expense_row.get("total_plan")), 600)

	def test_acc08_export_xlsx_matches_on_screen_values(self):
		"""TC-ACC-08: build_grouped_xlsx_data rows match execute presentation."""
		for accumulated in (0, 1):
			filters = self._base_filters(
				view_type="plan_only",
				show_plan=1,
				accumulated_values=accumulated,
			)
			filters.pop("cost_center", None)
			columns, data = execute(filters)
			if accumulated:
				data = apply_accumulated_presentation(data, columns, filters)

			xlsx_rows, _widths = build_grouped_xlsx_data(columns, data)
			self.assertGreaterEqual(len(xlsx_rows), 3)

			expense_row = next(row for row in data if row.get("account") == self.expense_account)
			data_row = None
			for row in xlsx_rows[2:]:
				if row and row[0] == self.expense_account:
					data_row = row
					break
			self.assertIsNotNone(data_row)

			total_plan_col = next(
				i for i, col in enumerate(columns) if col.get("fieldname") == "total_plan"
			)
			self.assertEqual(flt(data_row[total_plan_col]), flt(expense_row.get("total_plan")))

	def test_p3_project_portfolio_filter_limits_to_portfolio_projects(self):
		"""Phase 3: portfolio filter returns PRJ-B May actual only."""
		filters = self._base_filters(
			project_portfolio=self.portfolio,
			view_type="actual_only",
			from_month=5,
			to_month=5,
		)
		filters.pop("project", None)
		actual = self._cell(filters, self.expense_account, "actual", "2026_05")
		self.assertEqual(actual, 300)

	def test_p3_permissions_user_without_write_on_prj_b(self):
		"""Phase 3: permissions narrow multi-project filter to writable only."""
		user = f"bvf_perm_{frappe.generate_hash(length=6)}@example.com"
		if not frappe.db.exists("User", user):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": user,
					"first_name": "Administrator",
					"send_welcome_email": 0,
				}
			).insert(ignore_permissions=True)

		frappe.share.add("Project", self.project, user, write=1)
		frappe.share.add("Project", self.project_b, user, write=0, read=1)

		try:
			frappe.set_user(user)
			filters = {
				"company": self.company,
				"project": [self.project, self.project_b],
			}
			apply_report_project_permissions(filters)
			self.assertEqual(filters.get("project"), self.project)
		finally:
			frappe.set_user("Administrator")
			frappe.share.remove("Project", self.project, user)
			frappe.share.remove("Project", self.project_b, user)

	def _ensure_finance_books(self):
		suffix = frappe.generate_hash(length=6)
		default_fb = frappe.db.get_value("Company", self.company, "default_finance_book")
		if not default_fb or not frappe.db.exists("Finance Book", default_fb):
			default_fb = frappe.get_doc(
				{
					"doctype": "Finance Book",
					"finance_book_name": f"{PROJECT_A}-Default-FB-{suffix}",
				}
			).insert(ignore_permissions=True).name
		other_fb = frappe.get_doc(
			{
				"doctype": "Finance Book",
				"finance_book_name": f"{PROJECT_A}-Other-FB-{suffix}",
			}
		).insert(ignore_permissions=True).name
		return default_fb, other_fb

	def _post_journal(self, posting_date, debit, finance_book=None):
		je = frappe.new_doc("Journal Entry")
		je.company = self.company
		je.posting_date = posting_date
		if finance_book:
			je.finance_book = finance_book
		je.append(
			"accounts",
			{
				"account": self.expense_account,
				"debit_in_account_currency": debit,
				"credit_in_account_currency": 0,
				"cost_center": self.seed["cost_centers"]["main"],
				"project": self.project,
			},
		)
		je.append(
			"accounts",
			{
				"account": self.seed["balancing_account"],
				"debit_in_account_currency": 0,
				"credit_in_account_currency": debit,
			},
		)
		je.insert(ignore_permissions=True)
		je.submit()
		self._extra_journals = getattr(self, "_extra_journals", [])
		self._extra_journals.append(je.name)
