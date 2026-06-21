"""Pure EVM formula helpers for Project financial metrics."""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, getdate

from dinext_projects_pl.dinext_projects_pl.financial_metrics.constants import get_evm_metric_groups

TRACK_TYPES = ("Income", "Expense")


def compare_period_to_date(period: dict, reporting_date: date) -> int:
	"""Return -1, 0, or 1 when period month is before, equal to, or after reporting month."""
	reporting_year = reporting_date.year
	reporting_month = reporting_date.month
	period_year = int(period["year"])
	period_month = int(period["month"])

	if period_year < reporting_year or (period_year == reporting_year and period_month < reporting_month):
		return -1
	if period_year == reporting_year and period_month == reporting_month:
		return 0
	return 1


def get_plan_factor(period: dict, reporting_date: date) -> float:
	comparison = compare_period_to_date(period, reporting_date)
	if comparison < 0:
		return 1.0
	if comparison > 0:
		return 0.0

	days_in_month = calendar.monthrange(int(period["year"]), int(period["month"]))[1]
	return reporting_date.day / days_in_month


def get_actual_factor(period: dict, reporting_date: date) -> float:
	return get_plan_factor(period, reporting_date)


def safe_division(numerator: float | None, denominator: float | None) -> float | None:
	if numerator is None or denominator is None:
		return None
	if not denominator:
		return None
	return flt(numerator) / flt(denominator)


def get_metric_status(metric_key: str, value: float | None, track_type: str) -> str:
	if value is None:
		return "neutral"

	if track_type == "Income":
		return "neutral"

	if metric_key in {"CV", "SV", "VAC"}:
		return "good" if value >= 0 else "bad"
	if metric_key in {"CPI", "SPI"}:
		return "good" if value >= 1 else "bad"
	if metric_key == "TCPI":
		return "good" if value <= 1 else "bad"
	return "neutral"


def build_metric_groups(track_label: str, track_type: str, values: dict[str, float | None]) -> list[dict[str, Any]]:
	groups = []
	for group in get_evm_metric_groups():
		metrics = []
		for metric in group["metrics"]:
			value = values.get(metric["key"])
			metrics.append(
				{
					"key": metric["key"],
					"label": metric["label"],
					"kind": metric["kind"],
					"shortName": metric["shortName"],
					"formula": metric["formula"],
					"interpretation": metric["interpretation"],
					"value": value,
					"status": get_metric_status(metric["key"], value, track_type),
				}
			)
		groups.append({"key": group["key"], "label": group["label"], "metrics": metrics})
	return groups


def build_track_metrics(
	track_type: str,
	periods: list[dict],
	period_totals: dict[tuple[int, int], dict[str, float]],
	reporting_date: date,
	progress_percent: float,
) -> dict[str, Any]:
	bac = 0.0
	pv = 0.0
	ac = 0.0

	for period in periods:
		totals = period_totals.get((int(period["year"]), int(period["month"])), {"plan": 0.0, "fact": 0.0})
		plan = flt(totals.get("plan"))
		fact = flt(totals.get("fact"))
		bac += plan
		pv += plan * get_plan_factor(period, reporting_date)
		ac += fact * get_actual_factor(period, reporting_date)

	ev = bac * (progress_percent / 100)
	cv = ev - ac
	sv = ev - pv
	cpi = safe_division(ev, ac)
	spi = safe_division(ev, pv)
	eac = None
	if cpi not in (None, 0) and spi not in (None, 0):
		eac = ac + (bac - ev) / (cpi * spi)
	etc = eac - ac if eac is not None else None
	vac = bac - eac if eac is not None else None
	tcpi = safe_division(bac - ev, bac - ac) if bac != ac else None

	track_label = _("Доходы") if track_type == "Income" else _("Расходы")
	values = {
		"BAC": bac,
		"PV": pv,
		"EV": ev,
		"AC": ac,
		"CV": cv,
		"SV": sv,
		"CPI": cpi,
		"SPI": spi,
		"EAC": eac,
		"ETC": etc,
		"VAC": vac,
		"TCPI": tcpi,
	}

	return {
		"key": track_type.lower(),
		"label": track_label,
		"values": values,
		"groups": build_metric_groups(track_label, track_type, values),
	}


def build_financial_metrics_payload(
	project_doc,
	reporting_date_value: str,
	periods: list[dict],
	track_period_totals: dict[str, dict[tuple[int, int], dict[str, float]]],
) -> dict[str, Any]:
	if not project_doc.expected_start_date or not project_doc.expected_end_date:
		return {
			"ready": False,
			"emptyMessage": _("Финансовые метрики будут доступны после загрузки данных P&L."),
			"note": _("Метрики рассчитываются на выбранную отчетную дату."),
			"warning": None,
			"tracks": [],
		}

	reporting_date = getdate(reporting_date_value)
	progress_percent = flt(project_doc.percent_complete) or 0.0
	warnings = []

	if progress_percent <= 0:
		progress_label = frappe.get_meta("Project").get_label("percent_complete") or _("Процент выполнения")
		warnings.append(
			_(
				"Поле «{0}» не заполнено или равно 0. EV и производные метрики будут показаны как нулевые или недоступные."
			).format(progress_label)
		)

	tracks = [
		build_track_metrics(
			track_type,
			periods,
			track_period_totals.get(track_type, {}),
			reporting_date,
			progress_percent,
		)
		for track_type in TRACK_TYPES
	]

	return {
		"ready": True,
		"note": _(
			"Метрики рассчитываются на отчетную дату {0}. План и факт текущего месяца учитываются пропорционально дням месяца."
		).format(reporting_date_value),
		"warning": " ".join(warnings) if warnings else None,
		"reportingDate": reporting_date_value,
		"progressPercent": progress_percent,
		"tracks": tracks,
	}
