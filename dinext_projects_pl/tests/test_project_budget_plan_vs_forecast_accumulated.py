# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import copy

from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.columns import (
	add_total_columns,
	get_columns,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.periods import (
	aggregate_data_by_granularity,
	apply_accumulated_values,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	add_profit_row,
	add_row_totals,
)


def _month_columns(year=2026, months=(1, 2, 3), include_display=None):
	columns = []
	for month in months:
		month_key = f"{year}_{month:02d}"
		columns.append(
			{
				"fieldname": f"plan_{month_key}",
				"period_group": month_key,
				"period_role": "plan",
			}
		)
		if include_display == "actual":
			columns.append(
				{
					"fieldname": f"actual_{month_key}",
					"period_group": month_key,
					"period_role": "display",
				}
			)
		elif include_display == "forecast":
			columns.append(
				{
					"fieldname": f"forecast_{month_key}",
					"period_group": month_key,
					"period_role": "display",
				}
			)
	columns.append({"fieldname": "total_plan", "period_group": None})
	if include_display == "actual":
		columns.append({"fieldname": "total_fct", "period_group": None})
	elif include_display:
		columns.append({"fieldname": "total_exp_fct", "period_group": None})
	return columns


def _quarter_columns(year=2026):
	return [
		{
			"fieldname": f"plan_{year}_Q1",
			"period_group": f"{year}_Q1",
			"period_role": "plan",
		},
		{
			"fieldname": f"plan_{year}_Q2",
			"period_group": f"{year}_Q2",
			"period_role": "plan",
		},
		{"fieldname": "total_plan", "period_group": None},
	]


def _year_columns(year=2026):
	return [
		{
			"fieldname": f"plan_{year}",
			"period_group": str(year),
			"period_role": "plan",
		},
		{"fieldname": "total_plan", "period_group": None},
	]


def _sample_root_rows(year=2026, months=(1, 2, 3), values=None, include_display=None):
	values = values or {
		"income_plan": [100, 50, 30],
		"expense_plan": [40, 10, 5],
	}
	rows = [
		{
			"account": "Income Root",
			"indent": 0,
			"root_type": "Income",
		},
		{
			"account": "Expense Root",
			"indent": 0,
			"root_type": "Expense",
		},
	]
	for index, month in enumerate(months):
		month_key = f"{year}_{month:02d}"
		rows[0][f"plan_{month_key}"] = values["income_plan"][index]
		rows[1][f"plan_{month_key}"] = values["expense_plan"][index]
		if include_display == "actual":
			rows[0][f"actual_{month_key}"] = values.get("income_actual", values["income_plan"])[index]
			rows[1][f"actual_{month_key}"] = values.get("expense_actual", values["expense_plan"])[index]
		elif include_display == "forecast":
			rows[0][f"forecast_{month_key}"] = values.get("income_forecast", values["income_plan"])[index]
			rows[1][f"forecast_{month_key}"] = values.get("expense_forecast", values["expense_plan"])[index]
	return rows


def _profit_row(data):
	for row in data:
		if row.get("is_profit_row"):
			return row
	raise AssertionError("Profit row not found")


def _profitability_row(data):
	for row in data:
		if row.get("is_profitability_row"):
			return row
	raise AssertionError("Profitability row not found")


def _run_accumulated_pipeline(data, columns, filters):
	data = copy.deepcopy(data)
	if filters.get("period_granularity") not in (None, "", "month"):
		data = aggregate_data_by_granularity(data, filters)
	if filters.get("accumulated_values"):
		data = apply_accumulated_values(data, columns, filters)
	data = add_row_totals(data, filters, columns)
	return add_profit_row(data, columns, filters)


def _build_columns_from_filters(filters):
	columns = get_columns(filters, [])
	return add_total_columns(columns, filters)


class TestProjectBudgetPlanVsForecastAccumulated(FrappeTestCase):
	def test_apply_accumulated_values_builds_running_totals(self):
		year = 2026
		columns = _month_columns(year)
		data = [
			{
				"account": "Test",
				f"plan_{year}_01": 100,
				f"plan_{year}_02": 50,
				f"plan_{year}_03": 30,
			}
		]
		filters = {"accumulated_values": 1}

		result = apply_accumulated_values(data, columns, filters)[0]

		self.assertEqual(result[f"plan_{year}_01"], 100)
		self.assertEqual(result[f"plan_{year}_02"], 150)
		self.assertEqual(result[f"plan_{year}_03"], 180)

	def test_apply_accumulated_values_keeps_prefixes_independent(self):
		year = 2026
		columns = [
			{"fieldname": f"plan_{year}_01", "period_group": f"{year}_01"},
			{"fieldname": f"plan_{year}_02", "period_group": f"{year}_02"},
			{"fieldname": f"actual_{year}_01", "period_group": f"{year}_01"},
			{"fieldname": f"actual_{year}_02", "period_group": f"{year}_02"},
		]
		data = [
			{
				"account": "Test",
				f"plan_{year}_01": 10,
				f"plan_{year}_02": 5,
				f"actual_{year}_01": 100,
				f"actual_{year}_02": 20,
			}
		]

		result = apply_accumulated_values(data, columns, {"accumulated_values": 1})[0]

		self.assertEqual(result[f"plan_{year}_02"], 15)
		self.assertEqual(result[f"actual_{year}_02"], 120)

	def test_add_row_totals_accumulated_uses_last_period_not_sum(self):
		year = 2026
		columns = _month_columns(year)
		data = [
			{
				"account": "Income Root",
				f"plan_{year}_01": 100,
				f"plan_{year}_02": 150,
				f"plan_{year}_03": 180,
			}
		]
		filters = {"accumulated_values": 1, "show_plan": 1, "view_type": "plan_only"}

		result = add_row_totals(data, filters, columns)[0]

		self.assertEqual(result["total_plan"], 180)

	def test_add_row_totals_non_accumulated_sums_periods(self):
		year = 2026
		columns = _month_columns(year)
		data = [
			{
				"account": "Income Root",
				f"plan_{year}_01": 100,
				f"plan_{year}_02": 50,
				f"plan_{year}_03": 30,
			}
		]
		filters = {"accumulated_values": 0, "show_plan": 1, "view_type": "plan_only"}

		result = add_row_totals(data, filters, columns)[0]

		self.assertEqual(result["total_plan"], 180)

	def test_profit_row_total_plan_uses_last_accumulated_column(self):
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(year)
		filters = {
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		data = apply_accumulated_values(data, columns, filters)
		data = add_row_totals(data, filters, columns)
		data = add_profit_row(data, columns, filters)
		profit = _profit_row(data)

		self.assertEqual(profit[f"plan_{year}_01"], 60)
		self.assertEqual(profit[f"plan_{year}_02"], 100)
		self.assertEqual(profit[f"plan_{year}_03"], 125)
		self.assertEqual(profit["total_plan"], 125)

	def test_profit_row_total_plan_sums_periods_without_accumulation(self):
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(year)
		filters = {
			"accumulated_values": 0,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		data = add_row_totals(data, filters, columns)
		data = add_profit_row(data, columns, filters)
		profit = _profit_row(data)

		self.assertEqual(profit[f"plan_{year}_01"], 60)
		self.assertEqual(profit[f"plan_{year}_02"], 40)
		self.assertEqual(profit[f"plan_{year}_03"], 25)
		self.assertEqual(profit["total_plan"], 125)

	def test_accumulated_pipeline_does_not_overstate_profit_total(self):
		"""Regression: summing accumulated columns produced 285 instead of 125."""
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(year)
		filters = {
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		data = apply_accumulated_values(data, columns, filters)
		data = add_row_totals(data, filters, columns)
		data = add_profit_row(data, columns, filters)
		profit = _profit_row(data)

		wrong_total = (
			flt(profit[f"plan_{year}_01"])
			+ flt(profit[f"plan_{year}_02"])
			+ flt(profit[f"plan_{year}_03"])
		)
		self.assertNotEqual(wrong_total, profit["total_plan"])
		self.assertEqual(profit["total_plan"], flt(profit[f"plan_{year}_03"]))

	def test_zero_middle_period_accumulates_correctly(self):
		year = 2026
		columns = _month_columns(year)
		data = [
			{
				"account": "Income Root",
				"indent": 0,
				"root_type": "Income",
				f"plan_{year}_01": 100,
				f"plan_{year}_02": 0,
				f"plan_{year}_03": 20,
			},
			{
				"account": "Expense Root",
				"indent": 0,
				"root_type": "Expense",
				f"plan_{year}_01": 10,
				f"plan_{year}_02": 0,
				f"plan_{year}_03": 5,
			},
		]
		filters = {"accumulated_values": 1, "show_plan": 1, "view_type": "plan_only"}

		data = apply_accumulated_values(data, columns, filters)
		data = add_row_totals(data, filters, columns)
		data = add_profit_row(data, columns, filters)
		profit = _profit_row(data)

		self.assertEqual(profit[f"plan_{year}_02"], 90)
		self.assertEqual(profit[f"plan_{year}_03"], 105)
		self.assertEqual(profit["total_plan"], 105)

	def test_quarter_granularity_aggregate_and_accumulate(self):
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 1,
			"to_month": 6,
			"period_granularity": "quarter",
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}
		data = [
			{
				"account": "Income Root",
				"indent": 0,
				"root_type": "Income",
				"plan_2026_01": 10,
				"plan_2026_02": 20,
				"plan_2026_03": 30,
				"plan_2026_04": 40,
				"plan_2026_05": 50,
				"plan_2026_06": 60,
			},
			{
				"account": "Expense Root",
				"indent": 0,
				"root_type": "Expense",
				"plan_2026_01": 1,
				"plan_2026_02": 2,
				"plan_2026_03": 3,
				"plan_2026_04": 4,
				"plan_2026_05": 5,
				"plan_2026_06": 6,
			},
		]
		columns = _build_columns_from_filters(filters)

		result = _run_accumulated_pipeline(data, columns, filters)
		income = next(row for row in result if row.get("account") == "Income Root")
		profit = _profit_row(result)

		self.assertEqual(income["plan_2026_Q1"], 60)
		self.assertEqual(income["plan_2026_Q2"], 210)
		self.assertEqual(income["total_plan"], 210)
		self.assertEqual(profit["plan_2026_Q1"], 54)
		self.assertEqual(profit["plan_2026_Q2"], 189)
		self.assertEqual(profit["total_plan"], 189)

	def test_year_granularity_aggregate_and_accumulate(self):
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 1,
			"to_month": 3,
			"period_granularity": "year",
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}
		data = _sample_root_rows(year, months=(1, 2, 3))
		columns = _build_columns_from_filters(filters)

		result = _run_accumulated_pipeline(data, columns, filters)
		income = next(row for row in result if row.get("account") == "Income Root")
		profit = _profit_row(result)

		self.assertEqual(income[f"plan_{year}"], 180)
		self.assertEqual(income["total_plan"], 180)
		self.assertEqual(profit[f"plan_{year}"], 125)
		self.assertEqual(profit["total_plan"], 125)

	def test_forecast_actual_accumulated_display_total_uses_last_actual_column(self):
		"""Past-only actual columns share one prefix and accumulate together."""
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 1,
			"to_month": 2,
			"accumulated_values": 1,
			"show_plan": 0,
			"view_type": "forecast_actual",
		}
		data = _sample_root_rows(
			year,
			months=(1, 2),
			values={
				"income_plan": [100, 50],
				"expense_plan": [10, 5],
				"income_actual": [100, 50],
				"expense_actual": [10, 5],
			},
			include_display="actual",
		)
		columns = _month_columns(year, months=(1, 2), include_display="actual")
		columns = [
			col
			for col in columns
			if not col["fieldname"].startswith("plan_") and col["fieldname"] != "total_fct"
		]
		columns.append({"fieldname": "total_exp_fct", "period_group": None})

		result = _run_accumulated_pipeline(data, columns, filters)
		income = next(row for row in result if row.get("account") == "Income Root")
		profit = _profit_row(result)

		self.assertEqual(income["actual_2026_01"], 100)
		self.assertEqual(income["actual_2026_02"], 150)
		self.assertEqual(income["total_exp_fct"], 150)
		self.assertEqual(profit["actual_2026_01"], 90)
		self.assertEqual(profit["actual_2026_02"], 135)
		self.assertEqual(profit["total_exp_fct"], 135)

	def test_forecast_only_accumulated_display_total(self):
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 7,
			"to_month": 8,
			"accumulated_values": 1,
			"show_plan": 0,
			"view_type": "forecast_only",
		}
		data = _sample_root_rows(
			year,
			months=(7, 8),
			values={
				"income_plan": [0, 0],
				"expense_plan": [0, 0],
				"income_forecast": [200, 100],
				"expense_forecast": [80, 20],
			},
			include_display="forecast",
		)
		columns = _month_columns(year, months=(7, 8), include_display="forecast")
		columns = [
			col
			for col in columns
			if col["fieldname"] != "total_plan" and col["fieldname"] != "total_exp_fct"
		]
		columns.append({"fieldname": "total_exp", "period_group": None})

		result = _run_accumulated_pipeline(data, columns, filters)
		income = next(row for row in result if row.get("account") == "Income Root")
		profit = _profit_row(result)

		self.assertEqual(income["forecast_2026_07"], 200)
		self.assertEqual(income["forecast_2026_08"], 300)
		self.assertEqual(income["total_exp"], 300)
		self.assertEqual(profit["forecast_2026_07"], 120)
		self.assertEqual(profit["forecast_2026_08"], 200)
		self.assertEqual(profit["total_exp"], 200)

	def test_profitability_row_accumulated_matches_last_period(self):
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(year)
		filters = {
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		result = _run_accumulated_pipeline(data, columns, filters)
		profit = _profit_row(result)
		profitability = _profitability_row(result)

		self.assertEqual(profitability[f"plan_{year}_01"], flt((60 / 100) * 100, 1))
		self.assertEqual(profitability[f"plan_{year}_03"], flt((125 / 180) * 100, 1))
		self.assertEqual(profitability["total_plan"], profitability[f"plan_{year}_03"])
		self.assertEqual(profitability["total_plan"], flt((125 / 180) * 100, 1))

	def test_negative_profit_accumulated_pipeline(self):
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(
			year,
			values={
				"income_plan": [50, 50, 50],
				"expense_plan": [80, 10, 10],
			},
		)
		filters = {
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		result = _run_accumulated_pipeline(data, columns, filters)
		profit = _profit_row(result)
		profitability = _profitability_row(result)

		self.assertEqual(profit[f"plan_{year}_01"], -30)
		self.assertEqual(profit[f"plan_{year}_02"], 10)
		self.assertEqual(profit[f"plan_{year}_03"], 50)
		self.assertEqual(profit["total_plan"], 50)
		self.assertEqual(profitability[f"plan_{year}_01"], flt((-30 / 50) * 100, 1))
		self.assertEqual(profitability[f"plan_{year}_02"], flt((10 / 100) * 100, 1))
		self.assertEqual(profitability["total_plan"], flt((50 / 150) * 100, 1))

	def test_account_row_total_matches_profit_total_plan(self):
		year = 2026
		columns = _month_columns(year)
		data = _sample_root_rows(year)
		filters = {
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}

		result = _run_accumulated_pipeline(data, columns, filters)
		profit = _profit_row(result)
		income = next(row for row in result if row.get("account") == "Income Root")
		expense = next(row for row in result if row.get("account") == "Expense Root")

		self.assertEqual(income["total_plan"] - expense["total_plan"], profit["total_plan"])

	def test_get_columns_quarter_granularity_pipeline(self):
		"""End-to-end column builder + pipeline for quarter granularity."""
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 1,
			"to_month": 3,
			"period_granularity": "quarter",
			"accumulated_values": 1,
			"show_plan": 1,
			"view_type": "plan_only",
		}
		data = _sample_root_rows(year, months=(1, 2, 3))
		columns = _build_columns_from_filters(filters)

		fieldnames = [col["fieldname"] for col in columns if col.get("fieldname", "").startswith("plan_")]
		self.assertEqual(fieldnames, [f"plan_{year}_Q1"])

		result = _run_accumulated_pipeline(data, columns, filters)
		profit = _profit_row(result)
		self.assertEqual(profit[f"plan_{year}_Q1"], 125)
		self.assertEqual(profit["total_plan"], 125)

	def test_mixed_actual_and_forecast_accumulated_total_uses_last_display_column(self):
		"""actual_* and forecast_* accumulate separately; total follows last chronologic column."""
		year = 2026
		filters = {
			"from_year": year,
			"to_year": year,
			"from_month": 1,
			"to_month": 7,
			"accumulated_values": 1,
			"show_plan": 0,
			"view_type": "forecast_actual",
		}
		data = [
			{
				"account": "Income Root",
				"indent": 0,
				"root_type": "Income",
				"actual_2026_01": 100,
				"forecast_2026_07": 40,
			},
			{
				"account": "Expense Root",
				"indent": 0,
				"root_type": "Expense",
				"actual_2026_01": 20,
				"forecast_2026_07": 10,
			},
		]
		columns = [
			{
				"fieldname": "actual_2026_01",
				"period_group": "2026_01",
				"period_role": "display",
			},
			{
				"fieldname": "forecast_2026_07",
				"period_group": "2026_07",
				"period_role": "display",
			},
			{"fieldname": "total_exp_fct", "period_group": None},
		]

		result = _run_accumulated_pipeline(data, columns, filters)
		income = next(row for row in result if row.get("account") == "Income Root")
		profit = _profit_row(result)

		self.assertEqual(income["actual_2026_01"], 100)
		self.assertEqual(income["forecast_2026_07"], 40)
		self.assertEqual(income["total_exp_fct"], 40)
		self.assertEqual(profit["actual_2026_01"], 80)
		self.assertEqual(profit["forecast_2026_07"], 30)
		self.assertEqual(profit["total_exp_fct"], 30)

