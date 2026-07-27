# Copyright (c) 2026, Dinext
"""Whitelisted Desk / frappe.call entrypoints for dinext_projects_pl.

Project Budget core: `dinext_projects_pl.project_budget.*` (no whitelist there).
"""

from __future__ import annotations

import frappe

from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
	run_get_project_budget_grid,
)
from dinext_projects_pl.models import (
	ProjectBudgetGridFormInput,
	ProjectBudgetGridResponse,
	ProjectBudgetSaveForecastFormInput,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.save import (
	run_save_project_budget_forecast,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.dim_options import (
	run_add_project_budget_dimension,
	run_get_account_dimension_options,
)


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


@frappe.whitelist()
def get_account_dimension_options() -> dict:
	"""Dimension types + link options allowed for account (Accounting Dimension Filter)."""
	return run_get_account_dimension_options(frappe.form_dict)


@frappe.whitelist()
def add_project_budget_dimension() -> dict:
	"""Add dimension: new Project Budget bucket or mutate existing pb_docname."""
	return run_add_project_budget_dimension(frappe.form_dict)
