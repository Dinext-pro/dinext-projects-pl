# Copyright (c) 2025, Dinord and contributors
"""In-request caches for budget report allocation and dimension history."""

import frappe
from frappe.utils import flt, getdate, add_days, get_last_day, date_diff

from .query_builder import (
	allocation_history_queries,
	build_cost_center_allocation_children_query,
	build_cost_center_allocation_query,
)


class ReportAllocationCache:
	__slots__ = (
		"cc_by_project",
		"ba_by_project",
		"month_periods",
		"cc_allocation",
	)

	def __init__(self):
		self.cc_by_project = {}
		self.ba_by_project = {}
		self.month_periods = {}
		self.cc_allocation = {}


def init_report_cache():
	frappe.local.budget_report_cache = ReportAllocationCache()
	return frappe.local.budget_report_cache


def get_report_cache():
	return getattr(frappe.local, "budget_report_cache", None)


def clear_report_cache():
	frappe.local.budget_report_cache = None


def prefetch_allocation_histories(projects):
	if not projects:
		return

	cache = get_report_cache()
	if not cache:
		return

	missing_cc = [p for p in projects if p not in cache.cc_by_project]
	if missing_cc:
		cc_query, _ = allocation_history_queries(missing_cc)
		rows = cc_query.run(as_dict=True)
		for row in rows:
			cache.cc_by_project.setdefault(row.project, []).append(row)
		for project in missing_cc:
			cache.cc_by_project.setdefault(project, [])

	missing_ba = [p for p in projects if p not in cache.ba_by_project]
	if missing_ba:
		_, ba_query = allocation_history_queries(missing_ba)
		rows = ba_query.run(as_dict=True)
		for row in rows:
			cache.ba_by_project.setdefault(row.project, []).append(row)
		for project in missing_ba:
			cache.ba_by_project.setdefault(project, [])


def _filter_history_on_date(history, as_of_date):
	as_of = getdate(as_of_date)
	return [row for row in history if getdate(row.get("valid_from")) <= as_of]


def get_cached_cost_center_history(project, as_of_date):
	cache = get_report_cache()
	if cache and project in cache.cc_by_project:
		return _filter_history_on_date(cache.cc_by_project[project], as_of_date)
	return None


def get_cached_business_area_history(project, as_of_date):
	cache = get_report_cache()
	if cache and project in cache.ba_by_project:
		return _filter_history_on_date(cache.ba_by_project[project], as_of_date)
	return None


def _active_business_areas_on_date(ba_history, target_date):
	if not ba_history:
		return []

	target = getdate(target_date)
	active_rows = [row for row in ba_history if getdate(row.get("valid_from")) <= target]
	if not active_rows:
		return []

	latest_date = active_rows[0].get("valid_from")
	return [
		{
			"business_area": row.get("business_area"),
			"percent": flt(row.get("percent", 0)),
			"valid_from": row.get("valid_from"),
		}
		for row in active_rows
		if row.get("valid_from") == latest_date
	]


def _active_cost_center_on_date(cc_history, target_date):
	if not cc_history:
		return None

	target = getdate(target_date)
	for row in cc_history:
		if getdate(row.get("valid_from")) <= target:
			return row.get("cost_center")
	return None


def _are_ba_settings_equal(settings1, settings2):
	bas1 = settings1 or []
	bas2 = settings2 or []

	if len(bas1) != len(bas2):
		return False

	bas1_sorted = sorted(bas1, key=lambda x: x.get("business_area", ""))
	bas2_sorted = sorted(bas2, key=lambda x: x.get("business_area", ""))

	for ba1, ba2 in zip(bas1_sorted, bas2_sorted):
		if ba1.get("business_area") != ba2.get("business_area"):
			return False
		if abs(flt(ba1.get("percent", 0)) - flt(ba2.get("percent", 0))) > 0.01:
			return False

	return True


def get_cached_month_periods(project, year, month, cc_history=None, ba_history=None):
	cache = get_report_cache()
	key = (project, int(year), int(month))
	if cache and key in cache.month_periods:
		return cache.month_periods[key]

	year_int = int(year)
	month_int = int(month)
	if year_int == 0 or month_int == 0:
		return []

	month_start = getdate(f"{year_int}-{month_int:02d}-01")
	month_end = getdate(get_last_day(month_start))

	if cc_history is None:
		cc_history = get_cached_cost_center_history(project, month_end)
	if ba_history is None:
		ba_history = get_cached_business_area_history(project, month_end)

	cc_history = cc_history or []
	ba_history = ba_history or []

	change_dates = {month_start}
	for row in cc_history:
		valid_from = getdate(row.get("valid_from"))
		if month_start <= valid_from <= month_end:
			change_dates.add(valid_from)

	for row in ba_history:
		valid_from = getdate(row.get("valid_from"))
		if month_start <= valid_from <= month_end:
			change_dates.add(valid_from)

	sorted_dates = sorted(change_dates)
	periods = []

	for index, start_date in enumerate(sorted_dates):
		if index + 1 < len(sorted_dates):
			end_date = add_days(sorted_dates[index + 1], -1)
		else:
			end_date = month_end

		cc = _active_cost_center_on_date(cc_history, start_date)
		business_areas = _active_business_areas_on_date(ba_history, start_date)
		days = date_diff(end_date, start_date) + 1

		if business_areas or cc:
			periods.append(
				{
					"start_date": str(start_date),
					"end_date": str(end_date),
					"business_areas": business_areas,
					"cost_center": cc,
					"days": days,
				}
			)

	if cache is not None:
		cache.month_periods[key] = periods

	return periods


def get_cached_cost_center_allocation(main_cost_center, target_date):
	if not main_cost_center:
		return None

	cache = get_report_cache()
	cache_key = (main_cost_center, str(getdate(target_date)))
	if cache and cache_key in cache.cc_allocation:
		return cache.cc_allocation[cache_key]

	allocation = build_cost_center_allocation_query(main_cost_center, target_date).run(as_dict=True)

	if not allocation:
		result = None
	else:
		children = build_cost_center_allocation_children_query(allocation[0].name).run(
			as_dict=True
		)
		if not children:
			result = None
		else:
			result = {
				"name": allocation[0].name,
				"valid_from": allocation[0].valid_from,
				"children": children,
			}

	if cache is not None:
		cache.cc_allocation[cache_key] = result

	return result
