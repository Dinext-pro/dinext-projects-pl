# Copyright (c) 2026, Dinext
"""Whitelisted API for Project P&L grid v2."""

from __future__ import annotations

import frappe

from dinext_projects_pl.dinext_projects_pl.project_pl.v2.grid_data import run_get_pl_grid_v2
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.models import (
	PlV2GridFormInput,
	PlV2GridResponse,
	PlV2SaveForecastFormInput,
)
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.save import run_save_forecast_changes


@frappe.whitelist()
def get_pl_grid_v2() -> PlV2GridResponse:
	"""Scalar Project P&L grid v2 (DinextTable)."""
	form_input: PlV2GridFormInput = frappe.form_dict
	return run_get_pl_grid_v2(form_input)


@frappe.whitelist()
def pl_v2_save_forecast_changes() -> dict:
	"""Batch save forecast (pba_expected) from P&L grid v2."""
	form_input: PlV2SaveForecastFormInput = frappe.form_dict
	return run_save_forecast_changes(form_input)
