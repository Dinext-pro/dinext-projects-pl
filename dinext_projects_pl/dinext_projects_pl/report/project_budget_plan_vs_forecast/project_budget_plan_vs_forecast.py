# Copyright (c) 2025, Dinord and contributors
# For license information, please see license.txt
import frappe
import traceback
from frappe.utils import flt
from collections import defaultdict
from erpnext.accounts.report.financial_statements import filter_out_zero_value_rows

from .validate import validate_filters
from .columns import get_columns, add_total_columns, filter_zero_columns
from .budget_loader import get_accounts, get_budget_data
from .actual_loader import get_actual_data_simple
from .allocation_cache import clear_report_cache, init_report_cache, prefetch_allocation_histories
from .permissions import get_writable_report_projects
from .hierarchy import add_account_hierarchy, accumulate_all_values_upwards
from .totals import apply_forecast_actual_logic, add_row_totals, add_profit_row
from .periods import aggregate_data_by_granularity
from .risk_utils import build_report_risk_meta_row
from . import drilldown as budget_drilldown
from . import permissions as budget_permissions
from .debug_utils import _report_debug

__all__ = ["execute", "get_data", "get_budget_details", "get_profit_details", "get_report_project_options", "get_writable_report_project_names"]


@frappe.whitelist()
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
	return budget_drilldown.get_budget_details(
		account=account,
		year=year,
		month=month,
		quarter=quarter,
		period_key=period_key,
		period_granularity=period_granularity,
		data_type=data_type,
		project=project,
		project_portfolio=project_portfolio,
		cost_center=cost_center,
		business_area=business_area,
		company=company,
		apply_cc_allocation=apply_cc_allocation,
	)


@frappe.whitelist()
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
	return budget_drilldown.get_profit_details(
		year=year,
		month=month,
		quarter=quarter,
		period_key=period_key,
		period_granularity=period_granularity,
		data_type=data_type,
		project=project,
		project_portfolio=project_portfolio,
		cost_center=cost_center,
		business_area=business_area,
		company=company,
		apply_cc_allocation=apply_cc_allocation,
	)


@frappe.whitelist()
def get_writable_report_project_names(company=None):
	return budget_permissions.get_writable_report_project_names(company=company)


@frappe.whitelist()
def get_report_project_options(txt="", company=None):
	return budget_permissions.get_report_project_options(txt=txt, company=company)


def execute(filters=None):
    if not filters:
        filters = {}

    _report_debug("=== START REPORT EXECUTION ===", filters)
    _report_debug(f"ALL FILTERS: {filters}", filters)

    validate_filters(filters)
    data = get_data(filters)
    data = aggregate_data_by_granularity(data, filters)

    _report_debug(f"Total data rows after get_data: {len(data)}", filters)

    columns = get_columns(filters, data)

    if not filters.get("show_zero_columns"):
        columns = filter_zero_columns(columns, data)

    columns = add_total_columns(columns, filters)

    # Period-mode totals only; accumulated presentation is client-side (export uses apply_accumulated_presentation).
    period_filters = dict(filters)
    period_filters["accumulated_values"] = 0

    data = add_row_totals(data, period_filters, columns)
    data = add_profit_row(data, columns, period_filters)

    meta_row = build_report_risk_meta_row(filters.get("_report_risk_totals"))
    if meta_row:
        data.append(meta_row)

    _report_debug(f"Final data rows: {len(data)}", filters)
    _report_debug(f"Final columns: {[col['fieldname'] for col in columns]}", filters)
    _report_debug("=== END REPORT EXECUTION ===", filters)

    return columns, data


def _prepare_report_cache(filters):
    clear_report_cache()
    init_report_cache()

    if not (filters.get("cost_center") or filters.get("business_area")):
        return

    projects = filters.get("_report_writable_projects")
    if projects is None:
        projects = get_writable_report_projects(filters)
        filters["_report_writable_projects"] = projects

    prefetch_allocation_histories(projects)


def get_data(filters):
    try:
        _prepare_report_cache(filters)

        accounts = get_accounts(filters)
        accounts_by_name = {acc.name: acc for acc in accounts}
        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)

        budget_data = get_budget_data(filters, accounts)
        actual_data = get_actual_data_simple(filters)

        combined_data = {}

        for account in accounts:
            combined_data[account.name] = {
                "account": account.name,
                "parent_account": account.parent_account,
                "is_group": account.is_group,
                "root_type": account.root_type,
                "has_value": False,
                "is_leaf": False,
                "is_aggregated": False,
                "has_own_data": False,
            }

        for row in budget_data:
            account = row["account"]
            period_key = "{0}_{1:02d}".format(int(row["year"]), int(row["month"]))

            if account in combined_data:
                combined_data[account][f"plan_{period_key}"] = flt(row["plan"])
                combined_data[account][f"forecast_{period_key}"] = flt(row["forecast"])

                if flt(row["plan"]) != 0 or flt(row["forecast"]) != 0:
                    combined_data[account]["has_value"] = True
                    combined_data[account]["has_own_data"] = True

        if actual_data:
            for row in actual_data:
                account = row["account"]
                period_key = "{0}_{1:02d}".format(int(row["year"]), int(row["month"]))

                if account in combined_data:
                    combined_data[account][f"actual_{period_key}"] = flt(row["actual"])

                    if flt(row["actual"]) != 0:
                        combined_data[account]["has_value"] = True
                        combined_data[account]["has_own_data"] = True

        data = []
        root_accounts = [acc for acc in accounts if not acc.parent_account]
        root_accounts.sort(key=lambda x: (x.root_type != "Income", x.lft))

        for root_acc in root_accounts:
            add_account_hierarchy(root_acc, accounts, combined_data, data, 0)

        data = accumulate_all_values_upwards(data, parent_children_map, filters)

        if filters.get("view_type") == "forecast_actual":
            data = apply_forecast_actual_logic(data, filters)

        if not filters.get("show_zero_rows"):
            data = filter_out_zero_value_rows(data, parent_children_map, show_zero_values=False)

        return data
    except Exception as e:
        _report_debug(f"Error in get_data: {str(e)}", filters)
        frappe.log_error(f"Error in get_data: {traceback.format_exc()}")
        return []
