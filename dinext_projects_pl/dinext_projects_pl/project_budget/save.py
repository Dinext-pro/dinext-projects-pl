# Copyright (c) 2026, Dinext
"""Batch save forecast changes for Project Budget grid.

API: save_project_budget_forecast
Writes Project Budget.pba_expected for account × dimensions × period.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import (
	dimension_fingerprint,
	normalize_dimensions,
)
from dinext_projects_pl.models import (
	ProjectBudgetSaveForecastChange,
	ProjectBudgetSaveForecastFormInput,
)

PROJECT_BUDGET = "Project Budget"
SAVEPOINT_NAME = "save_project_budget_forecast"


def _parse_dimensions(raw: object) -> list[dict[str, str]]:
	if raw is None or raw == "":
		return []
	if isinstance(raw, str):
		try:
			raw = json.loads(raw)
		except Exception:
			return []
	if not isinstance(raw, list):
		return []
	return normalize_dimensions(raw)


def _find_project_budget(project: str, account: str, dimensions: list[dict[str, str]]) -> str | None:
	target = dimension_fingerprint(dimensions)
	for name in frappe.get_all(
		PROJECT_BUDGET,
		filters={"pb_project": project, "pb_account": account},
		pluck="name",
	):
		dims = frappe.get_all(
			"Project Budget Dimension",
			filters={"parent": name},
			fields=["doc", "docname"],
		)
		current = dimension_fingerprint(
			[{"doc": d.doc, "docname": d.docname} for d in dims]
		)
		if current == target:
			return name
	return None


def _get_or_create_project_budget(
	project: str, account: str, dimensions: list[dict[str, str]]
):
	existing = _find_project_budget(project, account, dimensions)
	if existing:
		return frappe.get_doc(PROJECT_BUDGET, existing)

	doc = frappe.new_doc(PROJECT_BUDGET)
	doc.pb_project = project
	doc.pb_account = account
	for dim in dimensions:
		doc.append("project_budget_dimension", dim)
	return doc


def _parse_change(change: ProjectBudgetSaveForecastChange) -> tuple[str, int, int, float, list[dict[str, str]]]:
	account = (change.get("account") or "").strip()
	if not account:
		frappe.throw(_("Account is required"))

	year = cint(change.get("year"))
	month = cint(change.get("month"))
	if not year or not month:
		period_key = change.get("period_key") or ""
		parts = str(period_key).split("_")
		if len(parts) >= 2:
			year = cint(parts[0])
			month = cint(parts[1])
	if not year or not month:
		frappe.throw(_("Period year/month is required"))

	return account, year, month, flt(change.get("value")), _parse_dimensions(change.get("dimensions"))


def _apply_period_value(doc, year: int, month: int, value: float) -> None:
	existing = None
	for row in doc.project_budget_amount or []:
		if cint(row.pba_year) == year and cint(row.pba_month) == month:
			existing = row
			break

	if existing:
		existing.pba_expected = value
	else:
		doc.append(
			"project_budget_amount",
			{
				"pba_year": year,
				"pba_month": month,
				"pba_expected": value,
			},
		)


def _persist_doc(doc) -> None:
	if doc.is_new():
		doc.insert()
	else:
		doc.save()


def _save_one_change(project: str, change: ProjectBudgetSaveForecastChange, docs_by_identity: dict) -> None:
	account, year, month, value, dimensions = _parse_change(change)
	identity = (account, dimension_fingerprint(dimensions))
	if identity not in docs_by_identity:
		docs_by_identity[identity] = _get_or_create_project_budget(project, account, dimensions)
	doc = docs_by_identity[identity]
	_apply_period_value(doc, year, month, value)
	_persist_doc(doc)


def run_save_project_budget_forecast(form_dict: ProjectBudgetSaveForecastFormInput) -> dict:
	project = form_dict.get("project")
	if not project:
		frappe.throw(_("Project is required"))

	if not frappe.has_permission("Project", "write", project):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission(PROJECT_BUDGET, "write"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	changes_raw = form_dict.get("changes")
	if changes_raw is None:
		changes: list[ProjectBudgetSaveForecastChange] = []
	elif isinstance(changes_raw, list):
		changes = changes_raw
	else:
		changes = json.loads(changes_raw)

	if not changes:
		return {"saved": 0}

	docs_by_identity: dict = {}
	frappe.db.savepoint(SAVEPOINT_NAME)
	try:
		for change in changes:
			_save_one_change(project, change, docs_by_identity)
	except Exception:
		frappe.db.rollback(save_point=SAVEPOINT_NAME)
		raise

	return {"saved": len(changes)}
