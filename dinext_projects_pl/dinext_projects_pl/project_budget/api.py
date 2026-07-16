# Copyright (c) 2026, Dinext
"""Whitelisted API for Project Budget grid."""

from __future__ import annotations

import frappe

from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import run_get_project_budget_grid
from dinext_projects_pl.dinext_projects_pl.project_budget.models import (
	ProjectBudgetGridFormInput,
	ProjectBudgetGridResponse,
	ProjectBudgetSaveForecastFormInput,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.save import run_save_project_budget_forecast


@frappe.whitelist()
def get_project_budget_grid() -> ProjectBudgetGridResponse:
	"""Scalar Project Budget grid (DinextTable)."""
	form_input: ProjectBudgetGridFormInput = frappe.form_dict
	return run_get_project_budget_grid(form_input)


@frappe.whitelist()
def save_project_budget_forecast() -> dict:
	"""Batch save forecast (pba_expected) from Project Budget grid."""
	form_input: ProjectBudgetSaveForecastFormInput = frappe.form_dict
	return run_save_project_budget_forecast(form_input)
