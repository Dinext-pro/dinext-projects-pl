# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from collections import defaultdict
from frappe.utils import flt, cint, add_days

from .actual_utils import signed_pl_amount
from .allocation import (
	calculate_allocation_for_month,
	get_business_area_history,
	get_cost_center_history,
)
from .debug_utils import _report_debug
from .query_builder import (
	build_gl_actual_query,
	build_purchase_draft_query,
	build_sales_draft_query,
)


def _get_period_dates(filters):
	from_year = cint(filters.get("from_year"))
	to_year = cint(filters.get("to_year"))
	from_month = cint(filters.get("from_month", 1))
	to_month = cint(filters.get("to_month", 12))

	start_date = f"{from_year}-{from_month:02d}-01"
	if to_month == 12:
		end_date = f"{to_year}-12-31"
	else:
		end_date = f"{to_year}-{to_month+1:02d}-01"
		end_date = add_days(end_date, -1)

	return start_date, end_date


def _project_has_dimension_history(project):
	if not project:
		return False
	return bool(get_cost_center_history(project) or get_business_area_history(project))


def _filtered_projects_have_dimension_history(filters):
	project = filters.get("project")
	if project:
		projects = project if isinstance(project, (list, tuple)) else [project]
		return any(_project_has_dimension_history(p) for p in projects)

	if filters.get("project_portfolio") or filters.get("company"):
		projects = filters.get("_report_writable_projects")
		if projects is None:
			from .permissions import get_writable_report_projects

			projects = get_writable_report_projects(filters)
		return any(_project_has_dimension_history(p) for p in (projects or []))

	return False


def _uses_project_dimension_path(filters):
	"""Load GL by project and match CC/BA via project history (not gle.cost_center)."""
	has_dimension_filter = filters.get("cost_center") or filters.get("business_area")
	if not has_dimension_filter:
		return False
	if cint(filters.get("apply_cc_allocation", 0)):
		return True
	return _filtered_projects_have_dimension_history(filters)


def _aggregate_allocated_rows(project_rows, filters):
	cost_center_filter = filters.get("cost_center")
	business_area_filter = filters.get("business_area")
	apply_allocation = cint(filters.get("apply_cc_allocation", 0))

	aggregated = defaultdict(float)
	for row in project_rows:
		project = row.get("project")
		if not project:
			continue

		amount = row.get("actual")
		if not amount:
			continue

		allocated = calculate_allocation_for_month(
			project=project,
			year=row["year"],
			month=row["month"],
			total_amount=amount,
			cost_center_filter=cost_center_filter,
			business_area_filter=business_area_filter,
			apply_allocation=apply_allocation,
		)

		if allocated:
			key = (row["account"], row["year"], row["month"])
			aggregated[key] += flt(allocated)

	return [
		{"account": account, "year": year, "month": month, "actual": amount}
		for (account, year, month), amount in aggregated.items()
		if amount
	]


def _fetch_gl_by_project(filters, start_date, end_date, gle_names=None):
	rows = build_gl_actual_query(
		filters,
		start_date,
		end_date,
		group_by_project=True,
		apply_cc_ba_filters=False,
		gle_names=gle_names,
	).run(as_dict=True)

	for row in rows:
		row["actual"] = signed_pl_amount(row.pop("root_type"), row.pop("debit"), row.pop("credit"))

	return rows


def _get_allocated_actual_data(filters, start_date, end_date, gle_names=None):
	_report_debug("=== GET ALLOCATED ACTUAL DATA START ===", filters)

	project_rows = _fetch_gl_by_project(filters, start_date, end_date, gle_names=gle_names)
	actual_data = _aggregate_allocated_rows(project_rows, filters)

	if filters.get("include_future_actual"):
		_report_debug("Including draft invoices with allocation path", filters)
		draft_rows = get_draft_invoice_data(filters, group_by_project=True)
		draft_allocated = _aggregate_allocated_rows(draft_rows, filters)
		actual_data = merge_actual_and_draft(actual_data, draft_allocated)

	_report_debug(f"Allocated actual data returned {len(actual_data)} rows", filters)
	return actual_data or []


def get_actual_data_simple(filters, gle_names=None):
	"""Получает фактические данные из GL Entry + черновики если включено"""
	try:
		_report_debug("=== GET ACTUAL DATA SIMPLE START ===", filters)

		if gle_names is not None and not gle_names:
			return []

		start_date, end_date = _get_period_dates(filters)

		if _uses_project_dimension_path(filters):
			return _get_allocated_actual_data(filters, start_date, end_date, gle_names=gle_names)

		actual_data = build_gl_actual_query(
			filters,
			start_date,
			end_date,
			group_by_project=False,
			apply_cc_ba_filters=True,
			gle_names=gle_names,
		).run(as_dict=True)

		for row in actual_data:
			row["actual"] = signed_pl_amount(row.pop("root_type"), row.pop("debit"), row.pop("credit"))

		if filters.get("include_future_actual"):
			_report_debug("Including draft invoices in actual data", filters)
			draft_data = get_draft_invoice_data(filters)
			actual_data = merge_actual_and_draft(actual_data, draft_data)
			_report_debug(
				f"After merging: {len(actual_data)} rows (GL: {len(actual_data) - len(draft_data)}, Drafts: {len(draft_data)})",
				filters,
			)

		_report_debug(f"Actual data simple query returned {len(actual_data)} rows", filters)
		return actual_data or []

	except Exception as e:
		_report_debug(f"Error in get_actual_data_simple: {str(e)}", filters)
		frappe.log_error(f"Error in get_actual_data_simple: {traceback.format_exc()}")
		return []


def get_draft_invoice_data(filters, group_by_project=False):
	"""Получает суммы из черновиков Sales и Purchase Invoice с учетом всех фильтров"""
	start_date, end_date = _get_period_dates(filters)
	apply_cc_ba_filters = not group_by_project
	draft_data = []

	sales_drafts = build_sales_draft_query(
		filters,
		start_date,
		end_date,
		group_by_project=group_by_project,
		apply_cc_ba_filters=apply_cc_ba_filters,
	).run(as_dict=True)

	_report_debug("Sales drafts raw data:", filters)
	for row in sales_drafts:
		_report_debug(
			f"  account={row['account']}, year={row['year']}, month={row['month']}, amount={row['amount']}",
			filters,
		)
		entry = {
			"account": row["account"],
			"year": row["year"],
			"month": row["month"],
			"actual": flt(row["amount"]),
		}
		if group_by_project:
			entry["project"] = row.get("project")
		draft_data.append(entry)

	purchase_drafts = build_purchase_draft_query(
		filters,
		start_date,
		end_date,
		group_by_project=group_by_project,
		apply_cc_ba_filters=apply_cc_ba_filters,
	).run(as_dict=True)

	for row in purchase_drafts:
		entry = {
			"account": row["account"],
			"year": row["year"],
			"month": row["month"],
			"actual": flt(row["amount"]),
		}
		if group_by_project:
			entry["project"] = row.get("project")
		draft_data.append(entry)

	_report_debug(
		f"Draft invoices data: {len(sales_drafts)} from Sales, {len(purchase_drafts)} from Purchase",
		filters,
	)
	return draft_data


def merge_actual_and_draft(actual_data, draft_data):
	"""Объединяет данные из GL Entry и черновиков"""

	_report_debug("=== MERGE ACTUAL AND DRAFT ===")
	_report_debug(f"GL data rows: {len(actual_data)}")
	_report_debug(f"Draft data rows: {len(draft_data)}")

	if draft_data:
		_report_debug("DRAFT INVOICES DATA:")
		for draft in draft_data:
			_report_debug(
				f"  Account: '{draft['account']}', Year: {draft['year']}, Month: {draft['month']}, Amount: {draft['actual']}"
			)

	if actual_data:
		_report_debug("GL DATA:")
		for row in actual_data:
			_report_debug(
				f"  Account: '{row['account']}', Year: {row['year']}, Month: {row['month']}, Amount: {row['actual']}"
			)

	data_dict = {}
	for row in actual_data:
		key = f"{row['account']}_{row['year']}_{row['month']}"
		data_dict[key] = row.copy()

	for draft in draft_data:
		key = f"{draft['account']}_{draft['year']}_{draft['month']}"

		if key in data_dict:
			old_value = data_dict[key]["actual"]
			data_dict[key]["actual"] += draft["actual"]
			_report_debug(f"MERGE: {key}: {old_value} + {draft['actual']} = {data_dict[key]['actual']}")
		else:
			data_dict[key] = {
				"account": draft["account"],
				"year": draft["year"],
				"month": draft["month"],
				"actual": draft["actual"],
			}
			_report_debug(f"NEW: {key}: {draft['actual']}")

	result = list(data_dict.values())

	_report_debug(f"RESULT after merge: {len(result)} rows")
	for row in result:
		_report_debug(
			f"  Account: '{row['account']}', Year: {row['year']}, Month: {row['month']}, Amount: {row['actual']}"
		)

	return result
