"""Dinext Budget Variance Report with group-account rollups."""

from __future__ import annotations

import datetime

import frappe
from erpnext.accounts.report.budget_variance_report.budget_variance_report import (
    get_chart_data,
    get_columns,
    validate_filters,
)
from erpnext.controllers.trends import get_period_month_ranges
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.budget_approval.group_account_budget import (
    get_descendant_account_names,
    get_dimension_descendant_names,
)


def execute(filters=None):
    filters = frappe._dict(filters or {})
    validate_filters(filters)

    columns = get_columns(filters)
    dimensions = filters.get("budget_against_filter") or _get_dimension_targets(filters)
    period_month_ranges = get_period_month_ranges(filters.period, filters.from_fiscal_year)
    cam_map = _get_dimension_account_month_map(filters)

    data = []
    for dimension in dimensions:
        dimension_items = cam_map.get(dimension)
        if dimension_items:
            data = _get_final_data(dimension, dimension_items, filters, period_month_ranges, data)

    chart = get_chart_data(filters, columns, data)
    return columns, data, None, chart


def _get_dimension_targets(filters):
    if filters.budget_against in {"Cost Center", "Project"}:
        query_filters = {"company": filters.company}
        order_by = "lft" if filters.budget_against == "Cost Center" else "name"
        return frappe.get_all(filters.budget_against, filters=query_filters, pluck="name", order_by=order_by)
    return frappe.get_all(filters.budget_against, pluck="name", order_by="name")


def _get_dimension_account_month_map(filters):
    fiscal_years = _get_fiscal_years(filters)
    target_details = _get_target_distribution_details(filters)
    cam_map = {}

    for budget in _get_budget_rows(filters):
        actual_details = _get_actual_details(budget, filters)
        for month_id in range(1, 13):
            month = datetime.date(2013, month_id, 1).strftime("%B")
            cam_map.setdefault(budget.budget_against, {}).setdefault(budget.account, {}).setdefault(
                budget.fiscal_year, {}
            ).setdefault(month, frappe._dict({"target": 0.0, "actual": 0.0}))

            tav = cam_map[budget.budget_against][budget.account][budget.fiscal_year][month]
            month_percentage = (
                target_details.get(budget.monthly_distribution, {}).get(month, 0)
                if budget.monthly_distribution
                else 100.0 / 12
            )
            tav.target = flt(budget.budget_amount) * month_percentage / 100

            for actual in actual_details:
                if actual.fiscal_year == budget.fiscal_year and actual.month_name == month:
                    tav.actual += flt(actual.debit) - flt(actual.credit)

    for dimension in filters.get("budget_against_filter") or []:
        cam_map.setdefault(dimension, {})

    for dimension in list(cam_map):
        for account in list(cam_map[dimension]):
            for fiscal_year in fiscal_years:
                cam_map[dimension][account].setdefault(fiscal_year, {})

    return cam_map


def _get_budget_rows(filters):
    budget_against_field = frappe.scrub(filters.budget_against)
    budget_filters = [
        ["company", "=", filters.company],
        ["docstatus", "=", 1],
        ["fiscal_year", ">=", filters.from_fiscal_year],
        ["fiscal_year", "<=", filters.to_fiscal_year],
        ["budget_against", "=", filters.budget_against],
    ]
    if filters.get("budget_against_filter"):
        budget_filters.append([budget_against_field, "in", filters.budget_against_filter])

    rows = []
    for budget_ref in frappe.get_all(
        "Budget",
        filters=budget_filters,
        fields=["name", budget_against_field, "monthly_distribution", "fiscal_year"],
        order_by="fiscal_year",
    ):
        budget = frappe.get_doc("Budget", budget_ref.name)
        for account_row in budget.accounts:
            rows.append(
                frappe._dict(
                    {
                        "budget": budget.name,
                        "budget_against": budget.get(budget_against_field),
                        "monthly_distribution": budget.monthly_distribution,
                        "account": account_row.account,
                        "budget_amount": account_row.budget_amount,
                        "fiscal_year": budget.fiscal_year,
                    }
                )
            )
    return rows


def _get_target_distribution_details(filters):
    result = {}
    distributions = frappe.get_all(
        "Monthly Distribution",
        filters=[
            ["fiscal_year", ">=", filters.from_fiscal_year],
            ["fiscal_year", "<=", filters.to_fiscal_year],
        ],
        pluck="name",
    )
    for distribution_name in distributions:
        distribution = frappe.get_doc("Monthly Distribution", distribution_name)
        for row in distribution.percentages:
            result.setdefault(distribution.name, {})[row.month] = flt(row.percentage_allocation)
    return result


def _get_actual_details(budget, filters):
    budget_against_field = frappe.scrub(filters.budget_against)
    dimension_names = get_dimension_descendant_names(filters.budget_against, budget.budget_against)
    rows = frappe.get_all(
        "GL Entry",
        filters=[
            ["account", "in", get_descendant_account_names(budget.account)],
            ["fiscal_year", ">=", filters.from_fiscal_year],
            ["fiscal_year", "<=", filters.to_fiscal_year],
            ["is_cancelled", "=", 0],
            ["company", "=", filters.company],
            ["docstatus", "=", 1],
            [budget_against_field, "in", dimension_names],
        ],
        fields=["debit", "credit", "fiscal_year", "posting_date"],
    )
    result = []
    for row in rows:
        result.append(
            frappe._dict(
                {
                    "debit": row.debit,
                    "credit": row.credit,
                    "fiscal_year": row.fiscal_year,
                    "month_name": row.posting_date.strftime("%B"),
                }
            )
        )
    return result


def _get_fiscal_years(filters):
    return frappe.get_all(
        "Fiscal Year",
        filters=[
            ["name", ">=", filters.from_fiscal_year],
            ["name", "<=", filters.to_fiscal_year],
        ],
        pluck="name",
        order_by="name",
    )


def _get_final_data(dimension, dimension_items, filters, period_month_ranges, data):
    for account, monthwise_data in dimension_items.items():
        row = [dimension, account]
        totals = [0, 0, 0]
        last_total = 0
        for fiscal_year in _get_fiscal_years(filters):
            for relevant_months in period_month_ranges:
                period_data = [0, 0, 0]
                for month in relevant_months:
                    month_data = monthwise_data.get(fiscal_year, {}).get(month, {})
                    for index, fieldname in enumerate(["target", "actual", "variance"]):
                        value = flt(month_data.get(fieldname))
                        period_data[index] += value
                        totals[index] += value

                period_data[0] += last_total
                if filters.get("show_cumulative"):
                    last_total = period_data[0] - period_data[1]

                period_data[2] = period_data[0] - period_data[1]
                row += period_data

        totals[2] = totals[0] - totals[1]
        if filters.period != "Yearly":
            row += totals
        data.append(row)

    return data
