# Copyright (c) 2026, Dinext
"""Available Accounting Dimensions for a P&L account + add Project Budget bucket."""

from __future__ import annotations

import json

import frappe
from frappe import _
from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import (
	normalize_dimensions,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.save import (
	_find_project_budget,
	_get_or_create_project_budget,
)

# Same exclusions as grid Task-filter helpers (structural / always-on dims).
SKIP_DIMENSION_LABELS = frozenset(
	{"Project", "Cost Center", "Project Portfolio", "Task", "Project Risk"}
)


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


def _company_for_project(project: str) -> str:
	company = frappe.db.get_value("Project", project, "company")
	if not company:
		frappe.throw(_("Project company is required"))
	return company


def _filters_for_account(company: str, account: str) -> list[dict]:
	"""Accounting Dimension Filter rows that apply to this account."""
	out: list[dict] = []
	for filt in frappe.get_all(
		"Accounting Dimension Filter",
		filters={"company": company, "disabled": 0},
		fields=["name", "accounting_dimension"],
		limit_page_length=0,
	):
		dim_name = (filt.get("accounting_dimension") or "").strip()
		if not dim_name or dim_name in SKIP_DIMENSION_LABELS:
			continue
		accounts = frappe.get_all(
			"Applicable On Account",
			filters={"parent": filt["name"]},
			pluck="applicable_on_account",
			limit_page_length=0,
		)
		if account not in set(accounts or []):
			continue
		doc_type = frappe.db.get_value("Accounting Dimension", dim_name, "document_type")
		if not doc_type:
			continue
		out.append(
			{
				"dimension": dim_name,
				"document_type": doc_type,
				"label": dim_name,
			}
		)
	return out


def _link_options(document_type: str, project: str, limit: int = 80) -> list[dict]:
	"""Label/value pairs for Link target of a dimension."""
	meta = frappe.get_meta(document_type)
	title_field = meta.get_title_field() or "name"
	filters: dict = {}
	if meta.has_field("project"):
		filters["project"] = project
	if meta.has_field("disabled"):
		filters["disabled"] = 0

	rows = frappe.get_all(
		document_type,
		filters=filters,
		fields=["name", title_field],
		order_by=f"{title_field} asc",
		limit_page_length=limit,
	)
	options: list[dict] = []
	for row in rows:
		name = row.get("name")
		if not name:
			continue
		label = row.get(title_field) or name
		options.append({"value": name, "label": str(label)})
	return options


def run_get_account_dimension_options(form_dict: dict) -> dict:
	project = (form_dict.get("project") or "").strip()
	account = (form_dict.get("account") or "").strip()
	if not project or not account:
		frappe.throw(_("Project and account are required"))
	if not frappe.has_permission("Project", "read", project):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	company = _company_for_project(project)
	dimensions = []
	for item in _filters_for_account(company, account):
		dimensions.append(
			{
				**item,
				"options": _link_options(item["document_type"], project),
			}
		)
	return {"project": project, "account": account, "dimensions": dimensions}


def run_add_project_budget_dimension(form_dict: dict) -> dict:
	"""Create or reuse Project Budget for account × dimensions.

	- mode=new (default): new fingerprint = base_dimensions + selected dim
	  (replaces same doc type if already in base).
	- mode=existing: append/replace dim on pb_docname, then save.
	"""
	project = (form_dict.get("project") or "").strip()
	account = (form_dict.get("account") or "").strip()
	dim_doc = (form_dict.get("dim_doc") or "").strip()
	dim_docname = (form_dict.get("dim_docname") or "").strip()
	mode = (form_dict.get("mode") or "new").strip().lower()
	pb_docname = (form_dict.get("pb_docname") or "").strip()

	if not project or not account:
		frappe.throw(_("Project and account are required"))
	if not dim_doc or not dim_docname:
		frappe.throw(_("Dimension is required"))
	if not frappe.has_permission("Project", "write", project):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission("Project Budget", "write"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	company = _company_for_project(project)
	allowed_types = {d["document_type"] for d in _filters_for_account(company, account)}
	if dim_doc not in allowed_types:
		frappe.throw(_("Dimension {0} is not allowed for account {1}").format(dim_doc, account))

	new_dim = {"doc": dim_doc, "docname": dim_docname}

	if mode == "existing" and pb_docname:
		if not frappe.db.exists("Project Budget", pb_docname):
			frappe.throw(_("Project Budget {0} not found").format(pb_docname))
		doc = frappe.get_doc("Project Budget", pb_docname)
		if doc.pb_project != project or doc.pb_account != account:
			frappe.throw(_("Project Budget does not match project/account"))
		kept = [
			{"doc": d.doc, "docname": d.docname}
			for d in (doc.project_budget_dimension or [])
			if d.doc and d.docname and d.doc != dim_doc
		]
		kept.append(new_dim)
		doc.set("project_budget_dimension", [])
		for dim in normalize_dimensions(kept):
			doc.append("project_budget_dimension", dim)
		doc.save()
		return {"name": doc.name, "mode": "existing", "created": 0}

	base = _parse_dimensions(form_dict.get("base_dimensions"))
	merged = [d for d in base if d.get("doc") != dim_doc]
	merged.append(new_dim)
	merged = normalize_dimensions(merged)

	existed = _find_project_budget(project, account, merged)
	doc = _get_or_create_project_budget(project, account, merged)
	created = 0
	if doc.is_new():
		doc.insert()
		created = 1
	elif not existed:
		doc.save()

	return {
		"name": doc.name,
		"mode": "new",
		"created": created,
		"dimensions": merged,
	}
