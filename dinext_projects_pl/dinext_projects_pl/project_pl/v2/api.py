# Copyright (c) 2026, Dinext
"""Deprecated whitelist aliases for Project Budget grid.

Prefer:
- dinext_projects_pl.dinext_projects_pl.project_budget.api.get_project_budget_grid
- dinext_projects_pl.dinext_projects_pl.project_budget.api.save_project_budget_forecast
"""

from __future__ import annotations

import frappe

from dinext_projects_pl.dinext_projects_pl.project_budget.api import (
	get_project_budget_grid,
	save_project_budget_forecast,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.models import (
	ProjectBudgetGridResponse,
)


@frappe.whitelist()
def get_pl_grid_v2() -> ProjectBudgetGridResponse:
	"""Deprecated alias of get_project_budget_grid."""
	return get_project_budget_grid()


@frappe.whitelist()
def pl_v2_save_forecast_changes() -> dict:
	"""Deprecated alias of save_project_budget_forecast."""
	return save_project_budget_forecast()
