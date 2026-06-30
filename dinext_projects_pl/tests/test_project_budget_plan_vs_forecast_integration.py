# Copyright (c) 2026, Dinext and Contributors
# See license.txt

"""Integration tests on deterministic TEST-PL-BVF-* seed data."""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.allocation import (
	calculate_allocation_for_month,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
	get_data,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	apply_accumulated_presentation,
)
from dinext_projects_pl.tests.fixtures.bvf_report_seed import (
	PROJECT_A,
	reset_bvf_report_seed,
	seed_bvf_report_seed,
)
from dinext_projects_pl.tests.test_project_budget_plan_vs_forecast_gl_parity import (
	gl_subtree_signed,
)


class TestProjectBudgetPlanVsForecastIntegration(FrappeTestCase):
	"""Phase 2 regression on shared BVF seed (see .issues/ISS-2026-00418/test-cases.md)."""

	PERIOD_APR = "2026_04"
	APR_START = "2026-04-01"
	APR_END = "2026-04-30"
	NET_EXPENSE_APR = 800  # 1000 debit - 200 credit
	ALLOCATED_CHILD_A = 480  # 800 * 60%

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.seed = seed_bvf_report_seed()
		cls.company = cls.seed["company"]
		cls.project = cls.seed["projects"]["a"]
		cls.expense_account = cls.seed["expense_account"]
		cls.income_account = cls.seed["income_account"]
		cls.child_cc_a = cls.seed["cost_centers"]["a"]

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

	def _execute_cell(self, filters, account, field_prefix, period_key):
		_columns, data = execute(filters)
		for row in data:
			if row.get("account") == account:
				return flt(row.get(f"{field_prefix}_{period_key}", 0))
		return 0

	def test_cc01_actual_with_allocation_matches_oracle(self):
		"""TC-CC-01: Child-A filter + allocation ON → 480 on expense (800 * 60%)."""
		filters = self._base_filters(
			cost_center=self.child_cc_a,
			view_type="actual_only",
			apply_cc_allocation=1,
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
			apply_allocation=1,
		)
		self.assertEqual(expected, self.ALLOCATED_CHILD_A)
		self.assertEqual(actual, self.ALLOCATED_CHILD_A)

	def test_cc02_apply_cc_allocation_zero_uses_project_period_cc_match(self):
		"""TC-CC-02: allocation OFF + Child-A filter → 0 (project CC is Main, not Child-A)."""
		filters = self._base_filters(
			cost_center=self.child_cc_a,
			view_type="actual_only",
			apply_cc_allocation=0,
			from_month=4,
			to_month=4,
		)
		actual = self._cell(filters, self.expense_account, "actual", self.PERIOD_APR)
		self.assertEqual(actual, 0)

	def test_cc02b_apply_cc_allocation_zero_main_cc_filter_matches_full_gl(self):
		"""TC-CC-02b: allocation OFF + Main filter → full net expense 800."""
		filters = self._base_filters(
			cost_center=self.seed["cost_centers"]["main"],
			view_type="actual_only",
			apply_cc_allocation=0,
			from_month=4,
			to_month=4,
		)
		actual = self._cell(filters, self.expense_account, "actual", self.PERIOD_APR)
		self.assertEqual(actual, self.NET_EXPENSE_APR)

	def test_cc06_multi_select_cc_allocation_on_sums_children(self):
		"""TC-CC-06: CC filter [A, B] + allocation ON → 800 (480 + 320)."""
		filters = self._base_filters(
			cost_center=[self.child_cc_a, self.seed["cost_centers"]["b"]],
			view_type="actual_only",
			apply_cc_allocation=1,
			from_month=4,
			to_month=4,
		)
		actual = self._cell(filters, self.expense_account, "actual", self.PERIOD_APR)
		self.assertEqual(actual, self.NET_EXPENSE_APR)

	def test_gl01_actual_without_cc_matches_gl_subtree(self):
		"""TC-GL-02 baseline: no CC filter → report actual = GL signed subtree."""
		filters = self._base_filters(
			view_type="actual_only",
			from_month=4,
			to_month=4,
		)
		filters.pop("cost_center", None)
		actual = self._cell(filters, self.expense_account, "actual", self.PERIOD_APR)
		gl_amount = gl_subtree_signed(
			self.project,
			self.expense_account,
			self.APR_START,
			self.APR_END,
			self.company,
		)
		self.assertEqual(gl_amount, self.NET_EXPENSE_APR)
		self.assertEqual(actual, gl_amount)

	def test_cc03_forecast_with_cc_allocation_on_execute(self):
		"""TC-CC-03: full execute() forecast with CC filter uses allocation on budget."""
		filters = self._base_filters(
			cost_center=self.child_cc_a,
			view_type="forecast_only",
			apply_cc_allocation=1,
			from_month=4,
			to_month=4,
		)
		forecast = self._execute_cell(filters, self.expense_account, "forecast", self.PERIOD_APR)
		expected = calculate_allocation_for_month(
			project=self.project,
			year=2026,
			month=4,
			total_amount=110,
			cost_center_filter=self.child_cc_a,
			apply_allocation=1,
		)
		self.assertEqual(expected, 66)  # 110 * 60%
		self.assertEqual(forecast, expected)

	def test_acc02_accumulated_export_pipeline_on_real_data(self):
		"""TC-ACC-02/03: apply_accumulated_presentation on real get_data — running totals."""
		filters = self._base_filters(
			view_type="plan_only",
			show_plan=1,
			from_month=4,
			to_month=6,
		)
		filters.pop("cost_center", None)
		_columns, period_data = execute(filters)
		acc_filters = {**filters, "accumulated_values": 1}
		acc_columns = _columns
		acc_data = apply_accumulated_presentation(period_data, acc_columns, acc_filters)

		expense_row = next(row for row in acc_data if row.get("account") == self.expense_account)
		self.assertEqual(flt(expense_row.get("plan_2026_04")), 100)
		self.assertEqual(flt(expense_row.get("plan_2026_05")), 300)  # 100 + 200
		self.assertEqual(flt(expense_row.get("plan_2026_06")), 600)  # 100 + 200 + 300
		self.assertEqual(flt(expense_row.get("total_plan")), 600)

	def test_acc08_execute_period_totals_without_accumulation(self):
		"""TC-ACC-01: period-mode execute totals sum months when accumulated=0."""
		filters = self._base_filters(
			view_type="plan_only",
			show_plan=1,
			accumulated_values=0,
			from_month=4,
			to_month=6,
		)
		filters.pop("cost_center", None)
		_columns, data = execute(filters)
		expense_row = next(row for row in data if row.get("account") == self.expense_account)
		self.assertEqual(flt(expense_row.get("total_plan")), 600)
