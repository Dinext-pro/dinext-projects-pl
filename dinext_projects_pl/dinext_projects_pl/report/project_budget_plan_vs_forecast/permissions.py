# Copyright (c) 2026, Dinord and contributors

"""Project access rules for Project Budget Plan vs Forecast report."""

from __future__ import annotations

import frappe

from .filter_utils import get_company_names, normalize_list_filter


def user_can_access_report_project(project: str) -> bool:
	"""Report data is limited to projects the user can read and write."""
	if not project:
		return False
	if not frappe.has_permission("Project", "read", project):
		return False
	return bool(frappe.has_permission("Project", "write", project))


def filter_writable_report_projects(projects: list[str]) -> list[str]:
	seen: set[str] = set()
	writable: list[str] = []
	for project in projects or []:
		if project in seen:
			continue
		seen.add(project)
		if user_can_access_report_project(project):
			writable.append(project)
	return writable


def get_writable_report_projects(filters) -> list[str]:
	"""Return projects visible in the report for the current user."""
	project_filter = normalize_list_filter(filters.get("project"))
	portfolio_filter = normalize_list_filter(filters.get("project_portfolio"))

	project_query_filters: dict = {}
	companies = get_company_names(filters)
	if companies:
		project_query_filters["company"] = companies[0] if len(companies) == 1 else ["in", companies]

	if portfolio_filter:
		project_query_filters["custom_project_portfolio"] = (
			portfolio_filter[0] if len(portfolio_filter) == 1 else ["in", portfolio_filter]
		)

	if project_filter:
		project_query_filters["name"] = (
			project_filter[0] if len(project_filter) == 1 else ["in", project_filter]
		)

	# get_list applies read permission_query_conditions; write is checked per project.
	candidates = frappe.get_list(
		"Project",
		filters=project_query_filters,
		pluck="name",
		limit_page_length=0,
	)
	return filter_writable_report_projects(candidates)


def apply_report_project_permissions(filters) -> None:
	"""Resolve and cache writable projects; narrow explicit project filter."""
	writable = get_writable_report_projects(filters)
	filters["_report_writable_projects"] = writable

	explicit = normalize_list_filter(filters.get("project"))
	if explicit is None:
		return

	allowed = [project for project in explicit if project in writable]
	if not allowed:
		filters.pop("project", None)
	elif len(allowed) == 1:
		filters["project"] = allowed[0]
	else:
		filters["project"] = allowed


def append_writable_projects_sql(conditions, filter_values, filters, project_column: str) -> None:
	"""Restrict SQL to writable projects when report is not scoped to explicit project filter."""
	if filters.get("project"):
		return

	writable = filters.get("_report_writable_projects")
	if writable is None:
		writable = get_writable_report_projects(filters)
		filters["_report_writable_projects"] = writable

	if not writable:
		conditions.append("1=0")
		return

	conditions.append(f"{project_column} IN %(report_writable_projects)s")
	filter_values["report_writable_projects"] = tuple(writable)


def append_writable_projects_query(query: str, params: dict, filters, project_column: str) -> str:
	"""String-builder variant for draft-invoice SQL fragments."""
	if filters.get("project"):
		return query

	writable = filters.get("_report_writable_projects")
	if writable is None:
		writable = get_writable_report_projects(filters)
		filters["_report_writable_projects"] = writable

	if not writable:
		return query + " AND 1=0"

	params["report_writable_projects"] = tuple(writable)
	return query + f" AND {project_column} IN %(report_writable_projects)s"


def restrict_to_writable_projects(projects: list[str], filters) -> list[str]:
	writable = set(filters.get("_report_writable_projects") or get_writable_report_projects(filters))
	return [project for project in projects if project in writable]


def get_report_project_options(txt: str = "", company: str | None = None) -> list[dict]:
	"""MultiSelectList options: only projects with read + write access."""
	filters = {"company": company or frappe.defaults.get_user_default("Company")}
	projects = get_writable_report_projects(filters)
	search = (txt or "").strip().lower()

	options = []
	for project in projects:
		if search and search not in project.lower():
			continue
		options.append({"value": project, "description": project})
		if len(options) >= 20:
			break

	return options
