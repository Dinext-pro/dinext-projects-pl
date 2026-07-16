# Copyright (c) 2026, Dinext
"""Периоды отображения для Project Budget grid."""

from __future__ import annotations

import frappe
from frappe.utils import add_months, get_first_day, getdate

from dinext_projects_pl.dinext_projects_pl.project_budget.models import (
	ProjectBudgetDisplayPeriod,
	ViewMode,
)

VIEW_MODE_FORECAST_AND_FACT: ViewMode = "forecast_and_fact"
VIEW_MODE_FORECAST_ONLY: ViewMode = "forecast_only"
VIEW_MODE_FACT_ONLY: ViewMode = "fact_only"

_VIEW_OPTIONS_MAP: dict[str, ViewMode] = {
	"Прогноз и факт": VIEW_MODE_FORECAST_AND_FACT,
	"Только прогноз": VIEW_MODE_FORECAST_ONLY,
	"Только факт": VIEW_MODE_FACT_ONLY,
	"Forecast and actual": VIEW_MODE_FORECAST_AND_FACT,
	"Forecast only": VIEW_MODE_FORECAST_ONLY,
	"Actual only": VIEW_MODE_FACT_ONLY,
}


def normalize_view_mode(view_options: str | None = None, view_mode: str | None = None) -> ViewMode:
	raw = (view_mode or view_options or "").strip()
	if not raw:
		return VIEW_MODE_FORECAST_AND_FACT
	if raw in (VIEW_MODE_FORECAST_AND_FACT, VIEW_MODE_FORECAST_ONLY, VIEW_MODE_FACT_ONLY):
		return raw  # type: ignore[return-value]
	return _VIEW_OPTIONS_MAP.get(raw, VIEW_MODE_FORECAST_AND_FACT)


def get_display_periods(
	project: str,
	period_type: str = "month",
	view_mode: ViewMode = VIEW_MODE_FORECAST_AND_FACT,
) -> list[ProjectBudgetDisplayPeriod]:
	if period_type != "month":
		frappe.throw(f"Unsupported period_type: {period_type}")

	doc = frappe.get_cached_doc("Project", project)
	month_start = getdate(get_first_day(frappe.utils.today()))
	start_date = getdate(doc.expected_start_date or month_start)
	end_date = getdate(doc.expected_end_date or add_months(start_date, 12))

	# Align to first day of month (legacy get_budget_display_periods).
	current = getdate(f"{start_date.year}-{start_date.month:02d}-01")
	end = getdate(f"{end_date.year}-{end_date.month:02d}-01")

	periods: list[ProjectBudgetDisplayPeriod] = []
	while current <= end:
		year = current.year
		month = current.month
		if view_mode == VIEW_MODE_FORECAST_ONLY:
			is_past = False
		elif view_mode == VIEW_MODE_FACT_ONLY:
			is_past = True
		else:
			is_past = current < month_start

		periods.append(
			{
				"year": year,
				"month": month,
				"key": f"{year}_{month}",
				"is_past": is_past,
			}
		)
		current = getdate(add_months(current, 1))

	return periods
