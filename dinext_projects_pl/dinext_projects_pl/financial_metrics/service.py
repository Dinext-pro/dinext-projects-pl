"""Whitelisted API for Project EVM financial metrics."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, today

from dinext_projects_pl.dinext_projects_pl.financial_metrics.calculations import build_financial_metrics_payload
from dinext_projects_pl.dinext_projects_pl.financial_metrics.data import get_track_period_totals


@frappe.whitelist()
def get_project_financial_metrics(project: str, reporting_date: str | None = None) -> dict:
	"""Calculate all EVM metrics for a Project on the server."""
	if not project:
		frappe.throw(_("Project is required"))

	if not frappe.has_permission("Project", "read", project):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	project_doc = frappe.get_doc("Project", project)
	reporting_date_value = reporting_date or project_doc.get("custom_metrics_reporting_date") or today()
	reporting_date_value = str(getdate(reporting_date_value))

	periods, track_period_totals = get_track_period_totals(project_doc)
	return build_financial_metrics_payload(
		project_doc,
		reporting_date_value,
		periods,
		track_period_totals,
	)
