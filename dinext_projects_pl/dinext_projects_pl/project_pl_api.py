# Copyright (c) 2026, Dinext
"""Whitelisted API for Server Script adapters (Project P&L)."""

import frappe

from dinext_projects_pl.dinext_projects_pl.forecast_from_work_efforts import (
    run_add_forecast_from_work_efforts,
)


@frappe.whitelist()
def pwr_run_add_forecast_from_work_efforts():
    """API method: add_forecast_from_work_efforts."""
    return run_add_forecast_from_work_efforts(frappe.form_dict)
