# Copyright (c) 2026, Dinext and contributors
"""Project Risk reserve handling aligned with project P&L (project_pl_calc.js)."""

from collections import defaultdict

from frappe.utils import cint, flt, getdate, today

from .periods import expand_period_key_to_monthly_keys, get_report_periods, parse_monthly_period_key

DATA_TYPE_WITH_RISK = "with_risk"
DATA_TYPE_WITH_TASK = "with_task"
DATA_TYPE_WITHOUT_TASK = "without_task"


def is_risk_row(row):
	"""True when the budget row carries a Project Risk dimension."""
	if not row:
		return False
	if row.get("data_type") == DATA_TYPE_WITH_RISK:
		return True
	return cint(row.get("is_risk")) == 1


def split_financial_and_risk_amounts(rows):
	"""Split raw loader rows into financial (report) vs risk reserve buckets."""
	financial = []
	risk = []
	for row in rows or []:
		if is_risk_row(row):
			risk.append(row)
		else:
			financial.append(row)
	return financial, risk


def sum_risk_amounts(risk_rows, period_key=None, *, value_key="forecast"):
	"""Sum plan/forecast on risk reserve rows (not rolled into CoA hierarchy)."""
	total = 0.0
	amount_field = "forecast" if value_key == "forecast" else "plan"
	for row in risk_rows or []:
		if period_key:
			year = int(row.get("pba_year", 0))
			month = int(row.get("pba_month", 0))
			if f"{year}_{month:02d}" != period_key:
				continue
		total += flt(row.get(amount_field, 0))
	return total


def merge_risk_totals(target, source):
	"""Merge {period_key: {plan, forecast}} buckets in-place."""
	for period_key, values in (source or {}).items():
		bucket = target.setdefault(period_key, {"plan": 0.0, "forecast": 0.0})
		bucket["plan"] += flt(values.get("plan"))
		bucket["forecast"] += flt(values.get("forecast"))


def aggregate_risk_totals_by_period(project, risk_rows, filters):
	"""Build per-period risk reserve totals with optional CC/BA allocation."""
	from .allocation import calculate_allocation_for_month

	if not risk_rows:
		return {}

	period_amounts = defaultdict(lambda: {"plan": 0.0, "forecast": 0.0})
	for row in risk_rows:
		year = int(row.get("pba_year", 0))
		month = int(row.get("pba_month", 0))
		if year == 0 or month == 0:
			continue
		period_key = f"{year}_{month:02d}"
		period_amounts[period_key]["plan"] += flt(row.get("plan", 0))
		period_amounts[period_key]["forecast"] += flt(row.get("forecast", 0))

	cost_center_filter = filters.get("cost_center")
	business_area_filter = filters.get("business_area")
	apply_allocation = filters.get("apply_cc_allocation", 0)
	totals = {}

	for period_key, amounts in period_amounts.items():
		year, month = map(int, period_key.split("_"))
		plan = amounts["plan"]
		forecast = amounts["forecast"]

		if cost_center_filter or business_area_filter:
			plan = (
				calculate_allocation_for_month(
					project=project,
					year=year,
					month=month,
					total_amount=plan,
					cost_center_filter=cost_center_filter,
					business_area_filter=business_area_filter,
					apply_allocation=apply_allocation,
				)
				if plan
				else 0
			)
			forecast = (
				calculate_allocation_for_month(
					project=project,
					year=year,
					month=month,
					total_amount=forecast,
					cost_center_filter=cost_center_filter,
					business_area_filter=business_area_filter,
					apply_allocation=apply_allocation,
				)
				if forecast
				else 0
			)

		if plan or forecast:
			totals[period_key] = {"plan": plan, "forecast": forecast}

	return totals


def is_past_report_period(year, month, as_of_date=None):
	current = getdate(as_of_date or today())
	return year < current.year or (year == current.year and month < current.month)


def _period_key_monthly_map(filters):
	mapping = {}
	if not filters or not cint(filters.get("from_year")) or not cint(filters.get("to_year")):
		return mapping
	for period in get_report_periods(filters):
		key = period.get("key")
		if key:
			mapping[key] = list(period.get("monthly_keys") or [])
	return mapping


def _monthly_keys_for_period(period_key, period_map=None):
	if period_map and period_key in period_map and period_map[period_key]:
		return period_map[period_key]
	return expand_period_key_to_monthly_keys(period_key)


def _sum_risk_for_monthly_keys(risk_totals, monthly_keys, value_key, include_month=None):
	total = 0.0
	for monthly_key in monthly_keys or []:
		if include_month:
			parsed = parse_monthly_period_key(monthly_key)
			if not parsed or not include_month(*parsed):
				continue
		total += flt((risk_totals.get(monthly_key) or {}).get(value_key))
	return total


def apply_risk_reserves_to_expense_by_column(expense_by_column, risk_totals, filters, monthly_columns):
	"""
	Add risk reserves to expense side for profit (not CoA rows).

	Matches project P&L: reserves reduce profit via forecast/plan tracks only.
	Risk totals stay on monthly keys; quarter/year columns sum those months.
	"""
	if not risk_totals:
		return

	view_type = (filters or {}).get("view_type", "forecast_actual")
	period_map = _period_key_monthly_map(filters)

	def include_forecast(year, month):
		if view_type == "forecast_only":
			return True
		if view_type == "forecast_actual":
			return not is_past_report_period(year, month)
		return False

	for col in monthly_columns or []:
		if col.startswith("plan_"):
			period_key = col[len("plan_") :]
			amount = _sum_risk_for_monthly_keys(
				risk_totals,
				_monthly_keys_for_period(period_key, period_map),
				"plan",
			)
			if amount:
				expense_by_column[col] = expense_by_column.get(col, 0) + amount
		elif col.startswith("forecast_"):
			period_key = col[len("forecast_") :]
			amount = _sum_risk_for_monthly_keys(
				risk_totals,
				_monthly_keys_for_period(period_key, period_map),
				"forecast",
				include_forecast,
			)
			if amount:
				expense_by_column[col] = expense_by_column.get(col, 0) + amount


def build_report_risk_meta_row(risk_totals):
	if not risk_totals:
		return None
	return {
		"account": "",
		"indent": -1,
		"is_report_meta": True,
		"risk_totals": risk_totals,
	}
