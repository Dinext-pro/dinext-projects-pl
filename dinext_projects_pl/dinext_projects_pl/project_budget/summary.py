# Copyright (c) 2026, Dinext
"""Summary rows P&L v2 — валовая прибыль + рентабельность (parity legacy totals)."""

from __future__ import annotations

import frappe

from dinext_projects_pl.models import (
	ProjectBudgetDisplayPeriod,
	ProjectBudgetRow,
)

PL_V2_SUMMARY_PROFIT_ID = "pl-v2-profit"
PL_V2_SUMMARY_PROFITABILITY_ID = "pl-v2-profitability"


def _to_float(value: object) -> float:
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def _calc_delta_pct(plan: float, actual: float) -> float:
	if not plan:
		return 0.0
	return round(((actual - plan) / plan) * 100, 1)


def _root_type(row: ProjectBudgetRow) -> str:
	return str(row.get("root_type") or "")


def _is_risk_row(row: ProjectBudgetRow) -> bool:
	return bool(row.get("risk"))


def _is_own_track(row: ProjectBudgetRow, key: str, track: str) -> bool:
	return _to_float(row.get(f"own_{track}_{key}")) > 0


def _risk_track_amount(row: ProjectBudgetRow, key: str, track: str) -> float:
	own = row.get(f"own_{track}_{key}")
	if own is not None:
		return _to_float(own)
	return _to_float(row.get(f"{track}_{key}"))


def _sum_risk_descendants(row: ProjectBudgetRow, key: str, track: str) -> float:
	total = 0.0
	for child in row.get("children") or []:
		if _is_risk_row(child):
			total += _risk_track_amount(child, key, track)
		else:
			total += _sum_risk_descendants(child, key, track)
	return total


def _risk_not_in_displayed(row: ProjectBudgetRow, key: str, track: str) -> float:
	"""Risk cut off by an own ancestor — not in that ancestor's displayed track."""
	if _is_risk_row(row):
		return 0.0
	if _is_own_track(row, key, track):
		return _sum_risk_descendants(row, key, track)
	total = 0.0
	for child in row.get("children") or []:
		if not _is_risk_row(child):
			total += _risk_not_in_displayed(child, key, track)
	return total


def _actual_uses_forecast(period: ProjectBudgetDisplayPeriod, view_mode: str) -> bool:
	if view_mode == "forecast_only":
		return True
	if view_mode == "fact_only":
		return False
	return not period.get("is_past")


def calc_period_income_expense(
	root_rows: list[ProjectBudgetRow],
	period: ProjectBudgetDisplayPeriod,
	view_mode: str = "forecast_and_fact",
) -> tuple[float, float, float, float]:
	"""Report addProfitRow: displayed Income/Expense + risk not already in display."""
	period_key = period["key"]
	plan_income = 0.0
	plan_expenses = 0.0
	actual_income = 0.0
	actual_expenses = 0.0

	for row in root_rows:
		plan = _to_float(row.get(f"plan_{period_key}"))
		actual = _to_float(row.get(f"actual_{period_key}"))
		rtype = _root_type(row)
		if rtype == "Expense":
			plan_expenses += plan + _risk_not_in_displayed(row, period_key, "plan")
			actual_expenses += actual
			if _actual_uses_forecast(period, view_mode):
				actual_expenses += _risk_not_in_displayed(row, period_key, "forecast")
		elif rtype == "Income":
			plan_income += plan
			actual_income += actual

	return plan_income, plan_expenses, actual_income, actual_expenses


def build_project_budget_summary_rows(
	root_rows: list[ProjectBudgetRow],
	periods: list[ProjectBudgetDisplayPeriod],
	view_mode: str = "forecast_and_fact",
) -> list[ProjectBudgetRow]:
	profit: ProjectBudgetRow = {
		"id": PL_V2_SUMMARY_PROFIT_ID,
		"account": PL_V2_SUMMARY_PROFIT_ID,
		"account_label": frappe._("Gross Profit"),
		"parent_account": None,
		"dimensions": [],
		"has_children": False,
		"indent": 0,
		"expandable": 0,
		"summary_kind": "profit",
	}
	profitability: ProjectBudgetRow = {
		"id": PL_V2_SUMMARY_PROFITABILITY_ID,
		"account": PL_V2_SUMMARY_PROFITABILITY_ID,
		"account_label": frappe._("Profitability"),
		"parent_account": None,
		"dimensions": [],
		"has_children": False,
		"indent": 0,
		"expandable": 0,
		"summary_kind": "profitability",
	}

	plan_income_total = 0.0
	plan_expenses_total = 0.0
	actual_income_total = 0.0
	actual_expenses_total = 0.0

	for period in periods:
		key = period["key"]
		plan_income, plan_expenses, actual_income, actual_expenses = calc_period_income_expense(
			root_rows, period, view_mode
		)
		plan_income_total += plan_income
		plan_expenses_total += plan_expenses
		actual_income_total += actual_income
		actual_expenses_total += actual_expenses

		profit_plan = plan_income - plan_expenses
		profit_actual = actual_income - actual_expenses

		profit[f"plan_{key}"] = profit_plan  # type: ignore[literal-required]
		profit[f"actual_{key}"] = profit_actual  # type: ignore[literal-required]
		profit[f"forecast_{key}"] = profit_actual if not period["is_past"] else 0.0  # type: ignore[literal-required]
		profit[f"fact_{key}"] = profit_actual if period["is_past"] else 0.0  # type: ignore[literal-required]
		profit[f"delta_{key}"] = _calc_delta_pct(profit_plan, profit_actual)  # type: ignore[literal-required]

		# Legacy: empty string when no income (UI shows bare "%"); not 0.0.
		prof_plan = round((profit_plan / plan_income) * 100, 1) if plan_income else None
		prof_actual = round((profit_actual / actual_income) * 100, 1) if actual_income else None
		profitability[f"plan_{key}"] = prof_plan  # type: ignore[literal-required]
		profitability[f"actual_{key}"] = prof_actual  # type: ignore[literal-required]
		profitability[f"forecast_{key}"] = prof_actual if not period["is_past"] else None  # type: ignore[literal-required]
		profitability[f"fact_{key}"] = prof_actual if period["is_past"] else None  # type: ignore[literal-required]
		profitability[f"delta_{key}"] = (  # type: ignore[literal-required]
			_calc_delta_pct(prof_plan, prof_actual)
			if prof_plan is not None and prof_actual is not None
			else None
		)

	profit_plan_total = plan_income_total - plan_expenses_total
	profit_actual_total = actual_income_total - actual_expenses_total
	profit["plan_total"] = profit_plan_total  # type: ignore[literal-required]
	profit["actual_total"] = profit_actual_total  # type: ignore[literal-required]
	profit["delta_total"] = _calc_delta_pct(profit_plan_total, profit_actual_total)  # type: ignore[literal-required]

	prof_plan_total = (
		round((profit_plan_total / plan_income_total) * 100, 1) if plan_income_total else None
	)
	prof_actual_total = (
		round((profit_actual_total / actual_income_total) * 100, 1) if actual_income_total else None
	)
	profitability["plan_total"] = prof_plan_total  # type: ignore[literal-required]
	profitability["actual_total"] = prof_actual_total  # type: ignore[literal-required]
	profitability["delta_total"] = (  # type: ignore[literal-required]
		_calc_delta_pct(prof_plan_total, prof_actual_total)
		if prof_plan_total is not None and prof_actual_total is not None
		else None
	)

	return [profit, profitability]
