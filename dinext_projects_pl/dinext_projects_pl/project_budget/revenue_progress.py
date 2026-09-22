# Copyright (c) 2026, Dinext
"""Scalar Revenue bar for Project Details — Income plan vs actual, no grid UI."""

from __future__ import annotations

import frappe
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
	run_get_project_budget_grid,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.summary import (
	calc_period_income_expense,
)


def _empty() -> dict:
	return {"plan": 0.0, "fact": 0.0, "percent": 0.0}


def _percent(plan: float, fact: float) -> float:
	if plan > 0:
		pct = (fact / plan) * 100
	elif fact > 0:
		pct = 100.0
	else:
		pct = 0.0
	return round(pct, 2)


def run_get_revenue_progress(project: str | None) -> dict:
	if not project:
		return _empty()

	grid = run_get_project_budget_grid(
		{
			"project": project,
			"period_type": "month",
			"show_zero_rows": True,
		}
	)
	plan = 0.0
	fact = 0.0
	for period in grid.get("periods") or []:
		plan_income, _pe, actual_income, _ae = calc_period_income_expense(
			grid.get("rows") or [], period
		)
		plan += plan_income
		fact += actual_income

	plan = flt(plan, 2)
	fact = flt(fact, 2)
	return {"plan": plan, "fact": fact, "percent": _percent(plan, fact)}
