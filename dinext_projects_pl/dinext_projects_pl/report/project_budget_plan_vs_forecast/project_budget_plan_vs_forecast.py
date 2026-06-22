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
from .hierarchy import add_account_hierarchy, accumulate_all_values_upwards
from .totals import apply_forecast_actual_logic, add_row_totals, add_profit_row
from .periods import apply_accumulated_values, compute_period_deltas
from .drilldown import get_budget_details

__all__ = ["execute", "get_data", "get_budget_details"]


def execute(filters=None):
    if not filters:
        filters = {}

    frappe.log("=== START REPORT EXECUTION ===")
    frappe.log(f"ALL FILTERS: {filters}")

    validate_filters(filters)
    data = get_data(filters)

    frappe.log(f"Total data rows after get_data: {len(data)}")

    columns = get_columns(filters, data)

    if not filters.get("show_zero_columns"):
        columns = filter_zero_columns(columns, data)

    columns = add_total_columns(columns, filters)

    data = add_row_totals(data, filters, columns)

    if filters.get("accumulated_values"):
        data = apply_accumulated_values(data, columns, filters)

    data = add_profit_row(data, columns, filters)

    data = compute_period_deltas(data, filters)

    frappe.log(f"Final data rows: {len(data)}")
    frappe.log(f"Final columns: {[col['fieldname'] for col in columns]}")
    frappe.log("=== END REPORT EXECUTION ===")

    return columns, data


def get_data(filters):
    try:
        frappe.log("=== GET DATA START ===")
        frappe.log(f"ALL FILTERS RECEIVED: {filters}")

        accounts = get_accounts(filters)
        accounts_by_name = {acc.name: acc for acc in accounts}
        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)

        budget_data = get_budget_data(filters, accounts)
        frappe.log(f"Budget data rows: {len(budget_data)}")

        actual_data = get_actual_data_simple(filters)
        frappe.log(f"Actual data rows: {len(actual_data) if actual_data else 0}")

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

        frappe.log(f"Final data rows: {len(data)}")
        frappe.log("=== GET DATA END ===")

        return data
    except Exception as e:
        frappe.log(f"Error in get_data: {str(e)}")
        frappe.log_error(f"Error in get_data: {traceback.format_exc()}")
        return []
