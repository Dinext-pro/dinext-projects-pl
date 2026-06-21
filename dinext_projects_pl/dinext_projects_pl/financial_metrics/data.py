"""Monthly plan/fact aggregation for Project EVM metrics."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

import frappe
from frappe.utils import add_months, flt, getdate

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	get_actual_data_simple,
	process_project_data,
)

TRACK_TYPES = ("Income", "Expense")


def get_project_monthly_periods(project_doc) -> list[dict]:
	"""Mirror client get_budget_display_periods(..., 'month') for project date range."""
	if not project_doc.expected_start_date or not project_doc.expected_end_date:
		return []

	start = getdate(project_doc.expected_start_date)
	end = getdate(project_doc.expected_end_date)
	current = date(start.year, start.month, 1)
	last = date(end.year, end.month, 1)
	periods = []

	while current <= last:
		periods.append({"year": current.year, "month": current.month})
		current = getdate(add_months(current, 1))

	return periods


def _get_project_date_bounds(project_doc) -> tuple[int, int, int, int]:
	start = getdate(project_doc.expected_start_date)
	end = getdate(project_doc.expected_end_date)
	return start.year, start.month, end.year, end.month


def _get_pl_accounts(company: str) -> list[dict]:
	return frappe.db.get_all(
		"Account",
		filters={
			"disabled": 0,
			"report_type": "Profit and Loss",
			"company": company,
		},
		fields=["name", "parent_account", "root_type", "lft"],
		order_by="lft asc",
		limit=0,
	)


def _collect_plan_values(project: str, company: str, from_year: int, from_month: int, to_year: int, to_month: int):
	filters = {
		"project": project,
		"company": company,
		"from_year": from_year,
		"to_year": to_year,
		"from_month": from_month,
		"to_month": to_month,
	}
	plan_values: dict[tuple[str, int, int], float] = defaultdict(float)

	for row in process_project_data(project, filters) or []:
		account = row.get("account")
		year = int(row.get("year") or 0)
		month = int(row.get("month") or 0)
		if not account or not year or not month:
			continue
		plan_values[(account, year, month)] += flt(row.get("plan"))

	return plan_values


def _collect_actual_values(project: str, company: str, from_year: int, from_month: int, to_year: int, to_month: int):
	filters = {
		"project": project,
		"company": company,
		"from_year": from_year,
		"to_year": to_year,
		"from_month": from_month,
		"to_month": to_month,
	}
	actual_values: dict[tuple[str, int, int], float] = defaultdict(float)

	for row in get_actual_data_simple(filters) or []:
		account = row.get("account")
		year = int(row.get("year") or 0)
		month = int(row.get("month") or 0)
		if not account or not year or not month:
			continue
		actual_values[(account, year, month)] += flt(row.get("actual"))

	return actual_values


def _rollup_account_period_values(
	account_values: dict[tuple[str, int, int], float],
	accounts: list[dict],
) -> dict[tuple[str, int, int], float]:
	"""Roll account-level values up to parent accounts bottom-up."""
	rolled = defaultdict(float, account_values)
	sorted_accounts = sorted(accounts, key=lambda row: row.lft or 0, reverse=True)

	for account in sorted_accounts:
		parent = account.parent_account
		if not parent:
			continue

		account_name = account.name
		keys = [key for key in rolled if key[0] == account_name]
		for _, year, month in keys:
			rolled[(parent, year, month)] += rolled[(account_name, year, month)]

	return rolled


def _sum_top_level_track_totals(
	accounts: list[dict],
	plan_values: dict[tuple[str, int, int], float],
	actual_values: dict[tuple[str, int, int], float],
) -> dict[str, dict[tuple[int, int], dict[str, float]]]:
	track_totals: dict[str, dict[tuple[int, int], dict[str, float]]] = {
		track_type: defaultdict(lambda: {"plan": 0.0, "fact": 0.0}) for track_type in TRACK_TYPES
	}
	top_level_accounts = [account for account in accounts if not account.parent_account]

	for account in top_level_accounts:
		track_type = account.root_type
		if track_type not in track_totals:
			continue

		account_name = account.name
		period_keys = {
			(key[1], key[2])
			for key in plan_values
			if key[0] == account_name
		} | {
			(key[1], key[2])
			for key in actual_values
			if key[0] == account_name
		}

		for year, month in period_keys:
			period_key = (year, month)
			track_totals[track_type][period_key]["plan"] += flt(plan_values.get((account_name, year, month)))
			track_totals[track_type][period_key]["fact"] += flt(actual_values.get((account_name, year, month)))

	return {
		track_type: {period: dict(values) for period, values in totals.items()}
		for track_type, totals in track_totals.items()
	}


def get_track_period_totals(project_doc) -> tuple[list[dict], dict[str, dict[tuple[int, int], dict[str, float]]]]:
	"""Return monthly periods and Income/Expense plan-fact totals keyed by (year, month)."""
	periods = get_project_monthly_periods(project_doc)
	if not periods:
		return [], {track_type: {} for track_type in TRACK_TYPES}

	from_year, from_month, to_year, to_month = _get_project_date_bounds(project_doc)
	accounts = _get_pl_accounts(project_doc.company)
	plan_values = _rollup_account_period_values(
		_collect_plan_values(project_doc.name, project_doc.company, from_year, from_month, to_year, to_month),
		accounts,
	)
	actual_values = _rollup_account_period_values(
		_collect_actual_values(project_doc.name, project_doc.company, from_year, from_month, to_year, to_month),
		accounts,
	)
	track_totals = _sum_top_level_track_totals(accounts, plan_values, actual_values)
	return periods, track_totals
