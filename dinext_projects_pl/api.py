# Copyright (c) 2026, Dinext
"""Whitelisted Desk / frappe.call entrypoints for dinext_projects_pl.

Project Budget core: `dinext_projects_pl.project_budget.*` (no whitelist there).
"""

from __future__ import annotations

import frappe

from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
	run_get_project_budget_grid,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.revenue_progress import (
	run_get_revenue_progress,
)
from dinext_projects_pl.models import (
	ProjectBudgetGridFormInput,
	ProjectBudgetGridResponse,
	ProjectBudgetSaveForecastFormInput,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.save import (
	run_save_project_budget_forecast,
)


@frappe.whitelist()
def get_project_budget_grid(
	project=None,
	period_type=None,
	view_options=None,
	view_mode=None,
	show_zero_rows=None,
) -> ProjectBudgetGridResponse:
	"""Scalar Project Budget grid (DinextTable)."""
	# Bind xcall kwargs explicitly — form_dict alone can drop 0 / collide with extras.
	form_dict = frappe.form_dict or {}
	form_input: ProjectBudgetGridFormInput = {
		"project": project if project is not None else form_dict.get("project"),
		"period_type": period_type if period_type is not None else form_dict.get("period_type"),
		"view_options": view_options if view_options is not None else form_dict.get("view_options"),
		"view_mode": view_mode if view_mode is not None else form_dict.get("view_mode"),
		"show_zero_rows": (
			show_zero_rows if show_zero_rows is not None else form_dict.get("show_zero_rows")
		),
	}
	return run_get_project_budget_grid(form_input)


@frappe.whitelist()
def get_revenue_progress(project: str | None = None) -> dict:
	"""Income plan vs actual for Project Details Revenue bar."""
	return run_get_revenue_progress(project)


@frappe.whitelist()
def save_project_budget_forecast() -> dict:
	"""Batch save forecast (pba_expected) from Project Budget grid."""
	form_input: ProjectBudgetSaveForecastFormInput = frappe.form_dict
	return run_save_project_budget_forecast(form_input)
