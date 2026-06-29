# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from collections import defaultdict
from frappe import _
from frappe.utils import cint, flt

from .budget_loader import get_accounts, process_project_data
from .filter_utils import normalize_filters, normalize_list_filter
from .hierarchy import build_hierarchy_for_project


def _resolve_month_periods(year, month=None, quarter=None, period_granularity=None, period_key=None):
	year = cint(year)

	if month not in (None, "", "total"):
		return [(year, cint(month))]

	if quarter not in (None, ""):
		quarter = cint(quarter)
		start_month = (quarter - 1) * 3 + 1
		return [(year, start_month + offset) for offset in range(3)]

	if period_key and "_Q" in str(period_key):
		_, _, quarter_part = str(period_key).partition("_Q")
		if quarter_part.isdigit():
			quarter = cint(quarter_part)
			start_month = (quarter - 1) * 3 + 1
			return [(year, start_month + offset) for offset in range(3)]

	if period_key and "_" in str(period_key):
		key_year, _, key_tail = str(period_key).partition("_")
		if key_tail.isdigit() and 1 <= cint(key_tail) <= 12:
			return [(cint(key_year or year), cint(key_tail))]

	granularity = (period_granularity or "month").lower()
	if granularity in ("year", "yearly") or (
		period_key and str(period_key).isdigit() and cint(period_key) == year
	):
		return [(year, month_no) for month_no in range(1, 13)]

	if month in (None, "", "total") and not quarter:
		return [(year, month_no) for month_no in range(1, 13)]

	return [(year, cint(month))]


def _build_period_label(year, month=None, quarter=None, period_granularity=None, period_key=None):
	if month not in (None, "", "total"):
		return f"{year}-{cint(month):02d}"
	if quarter not in (None, ""):
		return f"{year}-Q{cint(quarter)}"
	if period_key:
		return str(period_key).replace("_", "-")
	granularity = (period_granularity or "month").lower()
	if granularity in ("year", "yearly"):
		return str(year)
	return f"{year}"


def get_budget_details(
	account,
	year,
	month=None,
	quarter=None,
	period_key=None,
	period_granularity=None,
	data_type="plan",
	project=None,
	project_portfolio=None,
	cost_center=None,
	business_area=None,
	company=None,
	apply_cc_allocation=None,
):
	"""Return plan/forecast drill-down rows grouped by project for the selected period."""
	project = normalize_list_filter(project)
	project_portfolio = normalize_list_filter(project_portfolio)
	cost_center = normalize_list_filter(cost_center)
	business_area = normalize_list_filter(business_area)

	try:
		month_periods = _resolve_month_periods(
			year,
			month=month,
			quarter=quarter,
			period_granularity=period_granularity,
			period_key=period_key,
		)
		if not month_periods:
			return []

		period_label = _build_period_label(
			year,
			month=month,
			quarter=quarter,
			period_granularity=period_granularity,
			period_key=period_key,
		)

		from_year = min(item[0] for item in month_periods)
		to_year = max(item[0] for item in month_periods)
		from_month = min(item[1] for item in month_periods if item[0] == from_year)
		to_month = max(item[1] for item in month_periods if item[0] == to_year)

		filters = normalize_filters(
			{
				"company": company or frappe.defaults.get_user_default("Company"),
				"from_year": from_year,
				"to_year": to_year,
				"from_month": from_month,
				"to_month": to_month,
				"view_type": "forecast_only" if data_type == "forecast" else "plan_only",
				"show_zero_columns": 1,
				"enable_drill_down": 1,
				"apply_cc_allocation": cint(apply_cc_allocation),
				"project": project,
				"project_portfolio": project_portfolio,
				"cost_center": cost_center,
				"business_area": business_area,
			}
		)

		filter_from_year = cint(filters.get("from_year"))
		filter_to_year = cint(filters.get("to_year"))
		filter_from_month = cint(filters.get("from_month"))
		filter_to_month = cint(filters.get("to_month"))
		clipped_periods = []
		for period_year, period_month in month_periods:
			if period_year < filter_from_year or period_year > filter_to_year:
				continue
			if period_year == filter_from_year and period_month < filter_from_month:
				continue
			if period_year == filter_to_year and period_month > filter_to_month:
				continue
			clipped_periods.append((period_year, period_month))
		month_periods = clipped_periods or month_periods

		accounts = get_accounts(filters)
		parent_children_map = defaultdict(list)
		for acc in accounts:
			parent_children_map[acc.parent_account or None].append(acc)

		child_accounts = frappe.db.sql(
			"""
			SELECT name
			FROM `tabAccount`
			WHERE lft >= (SELECT lft FROM `tabAccount` WHERE name = %s)
				AND rgt <= (SELECT rgt FROM `tabAccount` WHERE name = %s)
				AND company = %s
			""",
			(account, account, filters["company"]),
			as_dict=1,
		)
		account_names = [row.name for row in child_accounts]
		if not account_names:
			return []

		month_values = sorted(set(month_periods))
		formatted_conditions = []
		for period_year, period_month in month_values:
			formatted_conditions.append(
				f"(pba.pba_year = {period_year} AND pba.pba_month = {period_month})"
			)
		projects_query = f"""
			SELECT DISTINCT pb.pb_project as project
			FROM `tabProject Budget Amount` pba
			INNER JOIN `tabProject Budget` pb ON pba.parent = pb.name
			LEFT JOIN `tabProject` p ON pb.pb_project = p.name
			WHERE pb.pb_account IN %(accounts)s
				AND ({" OR ".join(formatted_conditions)})
		"""
		params = {"accounts": tuple(account_names)}

		if project:
			if isinstance(project, (list, tuple)):
				if len(project) == 1:
					projects_query += " AND pb.pb_project = %(project)s"
					params["project"] = project[0]
				else:
					projects_query += " AND pb.pb_project IN %(project)s"
					params["project"] = tuple(project)
			else:
				projects_query += " AND pb.pb_project = %(project)s"
				params["project"] = project

		if project_portfolio:
			if isinstance(project_portfolio, (list, tuple)):
				if len(project_portfolio) == 1:
					projects_query += " AND p.custom_project_portfolio = %(project_portfolio)s"
					params["project_portfolio"] = project_portfolio[0]
				else:
					projects_query += " AND p.custom_project_portfolio IN %(project_portfolio)s"
					params["project_portfolio"] = tuple(project_portfolio)
			else:
				projects_query += " AND p.custom_project_portfolio = %(project_portfolio)s"
				params["project_portfolio"] = project_portfolio

		project_results = frappe.db.sql(projects_query, params, as_dict=1)
		projects_to_process = [row["project"] for row in project_results if row.get("project")]
		if not projects_to_process:
			return []

		aggregated = {}
		amount_type = _("Plan") if data_type == "plan" else _("Forecast")

		for proj in projects_to_process:
			project_raw_data = process_project_data(proj, filters)
			if not project_raw_data:
				continue

			project_hierarchy = build_hierarchy_for_project(
				project_raw_data,
				accounts,
				parent_children_map,
			)

			if account not in project_hierarchy:
				continue

			total_amount = 0.0
			for period_year, period_month in month_periods:
				period_key_month = f"{period_year}_{period_month:02d}"
				account_data = project_hierarchy[account]["data"].get(period_key_month)
				if not account_data:
					continue
				total_amount += flt(
					account_data["forecast"] if data_type == "forecast" else account_data["plan"]
				)

			if total_amount:
				aggregated[proj] = aggregated.get(proj, 0.0) + total_amount

		results = []
		for proj, amount in sorted(aggregated.items()):
			results.append(
				{
					"project": proj,
					"account": account,
					"year": cint(year),
					"month": cint(month) if month not in (None, "", "total") else None,
					"period_label": period_label,
					"amount": amount,
					"amount_type": amount_type,
				}
			)

		return results

	except Exception as e:
		frappe.log(f"Error in get_budget_details: {str(e)}")
		frappe.log_error(f"Error in get_budget_details: {traceback.format_exc()}")
		return []


def _expand_account_subtree(parent_children_map, root_names):
	expanded = set()
	stack = list(root_names or [])
	while stack:
		account_name = stack.pop()
		if account_name in expanded:
			continue
		expanded.add(account_name)
		for child in parent_children_map.get(account_name, []):
			stack.append(child.name)
	return list(expanded)


def _collect_project_hierarchy_amount(hierarchy, account_names, month_periods, data_type):
	total = 0.0
	value_key = "forecast" if data_type == "forecast" else "plan"
	for account_name in account_names:
		account_info = hierarchy.get(account_name)
		if not account_info:
			continue
		for period_year, period_month in month_periods:
			period_key = f"{period_year}_{period_month:02d}"
			period_data = account_info["data"].get(period_key)
			if period_data:
				total += flt(period_data.get(value_key))
	return total


def _get_drill_projects_for_accounts(filters, account_names, month_periods):
	if not account_names or not month_periods:
		return []

	month_values = sorted(set(month_periods))
	formatted_conditions = []
	for period_year, period_month in month_values:
		formatted_conditions.append(
			f"(pba.pba_year = {period_year} AND pba.pba_month = {period_month})"
		)

	projects_query = f"""
		SELECT DISTINCT pb.pb_project as project
		FROM `tabProject Budget Amount` pba
		INNER JOIN `tabProject Budget` pb ON pba.parent = pb.name
		LEFT JOIN `tabProject` p ON pb.pb_project = p.name
		WHERE pb.pb_account IN %(accounts)s
			AND ({" OR ".join(formatted_conditions)})
	"""
	params = {"accounts": tuple(account_names)}
	project = normalize_list_filter(filters.get("project"))
	project_portfolio = normalize_list_filter(filters.get("project_portfolio"))

	if project:
		if len(project) == 1:
			projects_query += " AND pb.pb_project = %(project)s"
			params["project"] = project[0]
		else:
			projects_query += " AND pb.pb_project IN %(project)s"
			params["project"] = tuple(project)
	elif project_portfolio:
		if len(project_portfolio) == 1:
			projects_query += " AND p.custom_project_portfolio = %(project_portfolio)s"
			params["project_portfolio"] = project_portfolio[0]
		else:
			projects_query += " AND p.custom_project_portfolio IN %(project_portfolio)s"
			params["project_portfolio"] = tuple(project_portfolio)

	project_results = frappe.db.sql(projects_query, params, as_dict=1)
	return [row["project"] for row in project_results if row.get("project")]


def get_profit_details(
	year,
	month=None,
	quarter=None,
	period_key=None,
	period_granularity=None,
	data_type="plan",
	project=None,
	project_portfolio=None,
	cost_center=None,
	business_area=None,
	company=None,
	apply_cc_allocation=None,
):
	"""Return gross profit drill-down rows grouped by project for the selected period."""
	project = normalize_list_filter(project)
	project_portfolio = normalize_list_filter(project_portfolio)
	cost_center = normalize_list_filter(cost_center)
	business_area = normalize_list_filter(business_area)

	try:
		month_periods = _resolve_month_periods(
			year,
			month=month,
			quarter=quarter,
			period_granularity=period_granularity,
			period_key=period_key,
		)
		if not month_periods:
			return []

		period_label = _build_period_label(
			year,
			month=month,
			quarter=quarter,
			period_granularity=period_granularity,
			period_key=period_key,
		)

		from_year = min(item[0] for item in month_periods)
		to_year = max(item[0] for item in month_periods)
		from_month = min(item[1] for item in month_periods if item[0] == from_year)
		to_month = max(item[1] for item in month_periods if item[0] == to_year)

		filters = normalize_filters(
			{
				"company": company or frappe.defaults.get_user_default("Company"),
				"from_year": from_year,
				"to_year": to_year,
				"from_month": from_month,
				"to_month": to_month,
				"view_type": "forecast_only" if data_type == "forecast" else "plan_only",
				"show_zero_columns": 1,
				"enable_drill_down": 1,
				"apply_cc_allocation": cint(apply_cc_allocation),
				"project": project,
				"project_portfolio": project_portfolio,
				"cost_center": cost_center,
				"business_area": business_area,
			}
		)

		filter_from_year = cint(filters.get("from_year"))
		filter_to_year = cint(filters.get("to_year"))
		filter_from_month = cint(filters.get("from_month"))
		filter_to_month = cint(filters.get("to_month"))
		clipped_periods = []
		for period_year, period_month in month_periods:
			if period_year < filter_from_year or period_year > filter_to_year:
				continue
			if period_year == filter_from_year and period_month < filter_from_month:
				continue
			if period_year == filter_to_year and period_month > filter_to_month:
				continue
			clipped_periods.append((period_year, period_month))
		month_periods = clipped_periods or month_periods

		from .project_budget_plan_vs_forecast import get_data
		from .totals import get_root_financial_nodes

		report_data = get_data(filters)
		root_income_nodes, root_expense_nodes = get_root_financial_nodes(report_data)
		if not root_income_nodes and not root_expense_nodes:
			return []

		accounts = get_accounts(filters)
		parent_children_map = defaultdict(list)
		for acc in accounts:
			parent_children_map[acc.parent_account or None].append(acc)

		drill_accounts = _expand_account_subtree(
			parent_children_map, root_income_nodes + root_expense_nodes
		)
		projects_to_process = _get_drill_projects_for_accounts(
			filters, drill_accounts, month_periods
		)
		if not projects_to_process:
			return []

		amount_type = _("Plan") if data_type == "plan" else _("Forecast")
		results = []

		for proj in projects_to_process:
			project_raw_data = process_project_data(proj, filters)
			if not project_raw_data:
				continue

			project_hierarchy = build_hierarchy_for_project(
				project_raw_data,
				accounts,
				parent_children_map,
			)

			income_total = _collect_project_hierarchy_amount(
				project_hierarchy, root_income_nodes, month_periods, data_type
			)
			expense_total = _collect_project_hierarchy_amount(
				project_hierarchy, root_expense_nodes, month_periods, data_type
			)
			profit = income_total - expense_total
			profitability = flt((profit / income_total) * 100, 1) if income_total else 0

			if not (income_total or expense_total or profit):
				continue

			results.append(
				{
					"project": proj,
					"income": income_total,
					"expense": expense_total,
					"profit": profit,
					"profitability": profitability,
					"year": cint(year),
					"month": cint(month) if month not in (None, "", "total") else None,
					"period_label": period_label,
					"amount_type": amount_type,
				}
			)

		return sorted(results, key=lambda row: row.get("project") or "")

	except Exception as e:
		frappe.log(f"Error in get_profit_details: {str(e)}")
		frappe.log_error(f"Error in get_profit_details: {traceback.format_exc()}")
		return []
