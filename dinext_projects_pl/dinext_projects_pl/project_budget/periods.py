# Copyright (c) 2026, Dinext
"""Периоды отображения для Project Budget grid (month / quarter / year)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_months, get_first_day, getdate

from dinext_projects_pl.models import (
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
	"Forecast and fact": VIEW_MODE_FORECAST_AND_FACT,
	"Forecast and Fact": VIEW_MODE_FORECAST_AND_FACT,
	"Forecast only": VIEW_MODE_FORECAST_ONLY,
	"Actual only": VIEW_MODE_FACT_ONLY,
	"Fact only": VIEW_MODE_FACT_ONLY,
	"Fact Only": VIEW_MODE_FACT_ONLY,
}

SUPPORTED_PERIOD_TYPES = frozenset({"month", "quarter", "year"})


def normalize_view_mode(view_options: str | None = None, view_mode: str | None = None) -> ViewMode:
	raw = (view_mode or view_options or "").strip()
	if not raw:
		return VIEW_MODE_FORECAST_AND_FACT
	if raw in (VIEW_MODE_FORECAST_AND_FACT, VIEW_MODE_FORECAST_ONLY, VIEW_MODE_FACT_ONLY):
		return raw  # type: ignore[return-value]
	return _VIEW_OPTIONS_MAP.get(raw, VIEW_MODE_FORECAST_AND_FACT)


def normalize_period_type(period_type: str | None) -> str:
	raw = (period_type or "month").strip().lower()
	if raw in ("quarterly",):
		return "quarter"
	if raw in ("yearly",):
		return "year"
	if raw in SUPPORTED_PERIOD_TYPES:
		return raw
	return "month"


def _month_key(year: int, month: int) -> str:
	"""Match Project Budget amount keys (no zero-pad): 2026_7."""
	return f"{year}_{month}"


def _is_past(view_mode: ViewMode, year: int, month: int, current_month_start) -> bool:
	period_start = getdate(f"{year}-{month:02d}-01")
	if view_mode == VIEW_MODE_FORECAST_ONLY:
		return False
	if view_mode == VIEW_MODE_FACT_ONLY:
		return True
	return period_start < current_month_start


def _iter_project_months(project: str) -> list[tuple[int, int]]:
	doc = frappe.get_cached_doc("Project", project)
	month_start = getdate(get_first_day(frappe.utils.today()))
	start_date = getdate(doc.expected_start_date or month_start)
	end_date = getdate(doc.expected_end_date or add_months(start_date, 12))
	current = getdate(f"{start_date.year}-{start_date.month:02d}-01")
	end = getdate(f"{end_date.year}-{end_date.month:02d}-01")
	months: list[tuple[int, int]] = []
	while current <= end:
		months.append((current.year, current.month))
		current = getdate(add_months(current, 1))
	return months


def get_display_periods(
	project: str,
	period_type: str = "month",
	view_mode: ViewMode = VIEW_MODE_FORECAST_AND_FACT,
) -> list[ProjectBudgetDisplayPeriod]:
	granularity = normalize_period_type(period_type)
	months = _iter_project_months(project)
	if not months:
		return []

	current_month_start = getdate(get_first_day(frappe.utils.today()))
	periods: list[ProjectBudgetDisplayPeriod] = []

	if granularity == "month":
		for year, month in months:
			periods.append(
				{
					"year": year,
					"month": month,
					"key": _month_key(year, month),
					"label": f"{year}-{month:02d}",
					"is_past": _is_past(view_mode, year, month, current_month_start),
					"monthly_keys": [_month_key(year, month)],
				}
			)
		return periods

	if granularity == "quarter":
		grouped: dict[tuple[int, int], list[tuple[int, int]]] = {}
		order: list[tuple[int, int]] = []
		for year, month in months:
			quarter = (month - 1) // 3 + 1
			gkey = (year, quarter)
			if gkey not in grouped:
				grouped[gkey] = []
				order.append(gkey)
			grouped[gkey].append((year, month))
		for year, quarter in order:
			yms = grouped[(year, quarter)]
			end_month = max(m for _, m in yms)
			periods.append(
				{
					"year": year,
					"month": yms[0][1],
					"quarter": quarter,
					"key": f"{year}_Q{quarter}",
					"label": _("Q{0} {1}").format(quarter, year),
					"is_past": _is_past(view_mode, year, end_month, current_month_start),
					"monthly_keys": [_month_key(y, m) for y, m in yms],
				}
			)
		return periods

	# year
	grouped_y: dict[int, list[tuple[int, int]]] = {}
	order_y: list[int] = []
	for year, month in months:
		if year not in grouped_y:
			grouped_y[year] = []
			order_y.append(year)
		grouped_y[year].append((year, month))
	for year in order_y:
		yms = grouped_y[year]
		end_month = max(m for _, m in yms)
		periods.append(
			{
				"year": year,
				"month": yms[0][1],
				"key": str(year),
				"label": str(year),
				"is_past": _is_past(view_mode, year, end_month, current_month_start),
				"monthly_keys": [_month_key(y, m) for y, m in yms],
			}
		)
	return periods


def period_month_keys(period: ProjectBudgetDisplayPeriod | dict) -> list[str]:
	keys = period.get("monthly_keys")
	if keys:
		return list(keys)
	key = period.get("key")
	if key:
		return [str(key)]
	year = period.get("year")
	month = period.get("month")
	if year and month:
		return [_month_key(int(year), int(month))]
	return []
