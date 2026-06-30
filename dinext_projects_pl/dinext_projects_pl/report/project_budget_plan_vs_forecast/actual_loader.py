# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from collections import defaultdict
from frappe.utils import flt, cint, add_days

from .actual_utils import append_finance_book_sql, signed_pl_amount
from .allocation import calculate_allocation_for_month
from .filter_utils import append_company_sql, apply_company_sql, apply_dimension_sql, append_dimension_sql
from .permissions import append_writable_projects_sql, append_writable_projects_query


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


def _uses_allocation_path(filters):
    has_dimension_filter = filters.get("cost_center") or filters.get("business_area")
    return bool(has_dimension_filter and cint(filters.get("apply_cc_allocation", 1)))


def _append_portfolio_sql(conditions, filter_values, filters):
    if filters.get("project_portfolio") and not filters.get("project"):
        portfolio = filters.get("project_portfolio")
        if isinstance(portfolio, (list, tuple)):
            conditions.append("""
                EXISTS (
                    SELECT 1 FROM `tabProject` p
                    WHERE p.name = gle.project
                    AND p.custom_project_portfolio IN %(project_portfolio)s
                )
            """)
            filter_values["project_portfolio"] = tuple(portfolio)
        else:
            conditions.append("""
                EXISTS (
                    SELECT 1 FROM `tabProject` p
                    WHERE p.name = gle.project
                    AND p.custom_project_portfolio = %(project_portfolio)s
                )
            """)
            filter_values["project_portfolio"] = portfolio


def _build_gl_conditions(filters, start_date, end_date, *, apply_cc_ba_filters):
    conditions = [
        "gle.posting_date BETWEEN %(start_date)s AND %(end_date)s",
        "gle.is_cancelled = 0",
    ]
    filter_values = {
        "start_date": start_date,
        "end_date": end_date,
    }

    apply_company_sql(conditions, filter_values, filters, "gle.company")
    apply_dimension_sql(conditions, filter_values, filters, "project", "gle.project")

    if apply_cc_ba_filters:
        apply_dimension_sql(conditions, filter_values, filters, "cost_center", "gle.cost_center")
        apply_dimension_sql(conditions, filter_values, filters, "business_area", "gle.business_area")

    append_finance_book_sql(conditions, filter_values, filters)
    _append_portfolio_sql(conditions, filter_values, filters)
    append_writable_projects_sql(conditions, filter_values, filters, "gle.project")

    return conditions, filter_values


def _aggregate_allocated_rows(project_rows, filters):
    cost_center_filter = filters.get("cost_center")
    business_area_filter = filters.get("business_area")
    apply_allocation = cint(filters.get("apply_cc_allocation", 1))

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


def _fetch_gl_by_project(filters, start_date, end_date):
    conditions, filter_values = _build_gl_conditions(
        filters, start_date, end_date, apply_cc_ba_filters=False
    )
    where_clause = " AND ".join(conditions)

    rows = frappe.db.sql("""
        SELECT
            gle.project,
            gle.account,
            YEAR(gle.posting_date) as year,
            MONTH(gle.posting_date) as month,
            a.root_type,
            ROUND(SUM(gle.debit), 0) as debit,
            ROUND(SUM(gle.credit), 0) as credit
        FROM `tabGL Entry` gle
        INNER JOIN `tabAccount` a ON gle.account = a.name
        WHERE {where_clause}
        GROUP BY gle.project, gle.account, YEAR(gle.posting_date), MONTH(gle.posting_date), a.root_type
        ORDER BY gle.project, YEAR(gle.posting_date), MONTH(gle.posting_date), gle.account
    """.format(where_clause=where_clause), filter_values, as_dict=1)

    for row in rows:
        row["actual"] = signed_pl_amount(row.pop("root_type"), row.pop("debit"), row.pop("credit"))

    return rows


def _get_allocated_actual_data(filters, start_date, end_date):
    frappe.log("=== GET ALLOCATED ACTUAL DATA START ===")

    project_rows = _fetch_gl_by_project(filters, start_date, end_date)
    actual_data = _aggregate_allocated_rows(project_rows, filters)

    if filters.get("include_future_actual"):
        frappe.log("Including draft invoices with allocation path")
        draft_rows = get_draft_invoice_data(filters, group_by_project=True)
        draft_allocated = _aggregate_allocated_rows(draft_rows, filters)
        actual_data = merge_actual_and_draft(actual_data, draft_allocated)

    frappe.log(f"Allocated actual data returned {len(actual_data)} rows")
    return actual_data or []


def get_actual_data_simple(filters):
    """Получает фактические данные из GL Entry + черновики если включено"""
    try:
        frappe.log("=== GET ACTUAL DATA SIMPLE START ===")

        start_date, end_date = _get_period_dates(filters)

        if _uses_allocation_path(filters):
            return _get_allocated_actual_data(filters, start_date, end_date)

        conditions, filter_values = _build_gl_conditions(
            filters, start_date, end_date, apply_cc_ba_filters=True
        )
        where_clause = " AND ".join(conditions)

        actual_data = frappe.db.sql("""
            SELECT
                gle.account,
                YEAR(gle.posting_date) as year,
                MONTH(gle.posting_date) as month,
                a.root_type,
                ROUND(SUM(gle.debit), 0) as debit,
                ROUND(SUM(gle.credit), 0) as credit
            FROM `tabGL Entry` gle
            INNER JOIN `tabAccount` a ON gle.account = a.name
            WHERE {where_clause}
            GROUP BY gle.account, YEAR(gle.posting_date), MONTH(gle.posting_date), a.root_type
            ORDER BY YEAR(gle.posting_date), MONTH(gle.posting_date), gle.account
        """.format(where_clause=where_clause), filter_values, as_dict=1)

        for row in actual_data:
            row["actual"] = signed_pl_amount(row.pop("root_type"), row.pop("debit"), row.pop("credit"))

        if filters.get("include_future_actual"):
            frappe.log("Including draft invoices in actual data")
            draft_data = get_draft_invoice_data(filters)
            actual_data = merge_actual_and_draft(actual_data, draft_data)
            frappe.log(
                f"After merging: {len(actual_data)} rows (GL: {len(actual_data) - len(draft_data)}, Drafts: {len(draft_data)})"
            )

        frappe.log(f"Actual data simple query returned {len(actual_data)} rows")
        return actual_data or []

    except Exception as e:
        frappe.log(f"Error in get_actual_data_simple: {str(e)}")
        frappe.log_error(f"Error in get_actual_data_simple: {traceback.format_exc()}")
        return []
        
def get_draft_invoice_data(filters, group_by_project=False):
    """Получает суммы из черновиков Sales и Purchase Invoice с учетом всех фильтров"""

    start_date, end_date = _get_period_dates(filters)
    apply_cc_ba_filters = not group_by_project

    draft_data = []

    # 1. Sales Invoice (доходы)
    sales_params = {
        "start_date": start_date,
        "end_date": end_date
    }

    sales_select = """
        SELECT
            {project_select}
            sii.income_account as account,
            YEAR(si.posting_date) as year,
            MONTH(si.posting_date) as month,
            SUM(sii.amount) as amount
        FROM `tabSales Invoice` si
        INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
        WHERE si.docstatus = 0
            AND si.posting_date BETWEEN %(start_date)s AND %(end_date)s
    """.format(
        project_select="si.project as project,\n            " if group_by_project else ""
    )

    sales_query = sales_select
    sales_query = append_company_sql(sales_query, sales_params, filters, "si.company")

    sales_query = append_dimension_sql(sales_query, sales_params, filters, "project", "si.project")
    if apply_cc_ba_filters:
        sales_query = append_dimension_sql(sales_query, sales_params, filters, "cost_center", "sii.cost_center")
        # SI uses standard Accounting Dimension field (same as gle.business_area on GL Entry).
        sales_query = append_dimension_sql(
            sales_query, sales_params, filters, "business_area", "si.business_area"
        )

    # Фильтр по project_portfolio
    if filters.get("project_portfolio") and not filters.get("project"):
        portfolio = filters.get("project_portfolio")
        if isinstance(portfolio, (list, tuple)):
            sales_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p
                WHERE p.name = si.project
                AND p.custom_project_portfolio IN %(project_portfolio)s
            )
        """
            sales_params["project_portfolio"] = tuple(portfolio)
        else:
            sales_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p
                WHERE p.name = si.project
                AND p.custom_project_portfolio = %(project_portfolio)s
            )
        """
            sales_params["project_portfolio"] = portfolio

    sales_query = append_writable_projects_query(sales_query, sales_params, filters, "si.project")
    
    sales_group_by = (
        "si.project, sii.income_account, YEAR(si.posting_date), MONTH(si.posting_date)"
        if group_by_project
        else "sii.income_account, YEAR(si.posting_date), MONTH(si.posting_date)"
    )
    sales_query += f" GROUP BY {sales_group_by}"

    sales_drafts = frappe.db.sql(sales_query, sales_params, as_dict=1)

    frappe.log("Sales drafts raw data:")

    for row in sales_drafts:
        frappe.log(f"  account={row['account']}, year={row['year']}, month={row['month']}, amount={row['amount']}")
        entry = {
            "account": row["account"],
            "year": row["year"],
            "month": row["month"],
            "actual": flt(row["amount"]),
        }
        if group_by_project:
            entry["project"] = row.get("project")
        draft_data.append(entry)

    # 2. Purchase Invoice (расходы)
    purchase_params = {
        "start_date": start_date,
        "end_date": end_date
    }

    purchase_select = """
        SELECT
            {project_select}
            pii.expense_account as account,
            YEAR(pi.posting_date) as year,
            MONTH(pi.posting_date) as month,
            SUM(pii.amount) as amount
        FROM `tabPurchase Invoice` pi
        INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE pi.docstatus = 0
            AND pi.posting_date BETWEEN %(start_date)s AND %(end_date)s
    """.format(
        project_select="pii.project as project,\n            " if group_by_project else ""
    )

    purchase_query = purchase_select
    purchase_query = append_company_sql(purchase_query, purchase_params, filters, "pi.company")

    purchase_query = append_dimension_sql(purchase_query, purchase_params, filters, "project", "pii.project")
    if apply_cc_ba_filters:
        purchase_query = append_dimension_sql(purchase_query, purchase_params, filters, "cost_center", "pii.cost_center")
        # PI uses standard Accounting Dimension field (same as gle.business_area on GL Entry).
        purchase_query = append_dimension_sql(
            purchase_query, purchase_params, filters, "business_area", "pi.business_area"
        )

    if filters.get("project_portfolio") and not filters.get("project"):
        portfolio = filters.get("project_portfolio")
        if isinstance(portfolio, (list, tuple)):
            purchase_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p
                WHERE p.name = pii.project
                AND p.custom_project_portfolio IN %(project_portfolio)s
            )
        """
            purchase_params["project_portfolio"] = tuple(portfolio)
        else:
            purchase_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p
                WHERE p.name = pii.project
                AND p.custom_project_portfolio = %(project_portfolio)s
            )
        """
            purchase_params["project_portfolio"] = portfolio

    purchase_query = append_writable_projects_query(
        purchase_query, purchase_params, filters, "pii.project"
    )
    
    purchase_group_by = (
        "pii.project, pii.expense_account, YEAR(pi.posting_date), MONTH(pi.posting_date)"
        if group_by_project
        else "pii.expense_account, YEAR(pi.posting_date), MONTH(pi.posting_date)"
    )
    purchase_query += f" GROUP BY {purchase_group_by}"

    purchase_drafts = frappe.db.sql(purchase_query, purchase_params, as_dict=1)

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
    
    frappe.log(f"Draft invoices data: {len(sales_drafts)} from Sales, {len(purchase_drafts)} from Purchase")
    
    return draft_data
    
def merge_actual_and_draft(actual_data, draft_data):
    """Объединяет данные из GL Entry и черновиков"""
    
    frappe.log("=== MERGE ACTUAL AND DRAFT ===")
    frappe.log(f"GL data rows: {len(actual_data)}")
    frappe.log(f"Draft data rows: {len(draft_data)}")
    
    # Логируем ВСЕ черновики
    if draft_data:
        frappe.log("DRAFT INVOICES DATA:")
        for draft in draft_data:
            frappe.log(f"  Account: '{draft['account']}', Year: {draft['year']}, Month: {draft['month']}, Amount: {draft['actual']}")
    
    # Логируем GL данные
    if actual_data:
        frappe.log("GL DATA:")
        for row in actual_data:
            frappe.log(f"  Account: '{row['account']}', Year: {row['year']}, Month: {row['month']}, Amount: {row['actual']}")
    
    # Создаем словарь из actual_data
    data_dict = {}
    for row in actual_data:
        key = f"{row['account']}_{row['year']}_{row['month']}"
        data_dict[key] = row.copy()
    
    # Добавляем суммы из черновиков
    for draft in draft_data:
        key = f"{draft['account']}_{draft['year']}_{draft['month']}"
        
        if key in data_dict:
            old_value = data_dict[key]['actual']
            data_dict[key]['actual'] += draft['actual']
            frappe.log(f"MERGE: {key}: {old_value} + {draft['actual']} = {data_dict[key]['actual']}")
        else:
            data_dict[key] = {
                'account': draft['account'],
                'year': draft['year'],
                'month': draft['month'],
                'actual': draft['actual']
            }
            frappe.log(f"NEW: {key}: {draft['actual']}")
    
    result = list(data_dict.values())
    
    frappe.log(f"RESULT after merge: {len(result)} rows")
    for row in result:
        frappe.log(f"  Account: '{row['account']}', Year: {row['year']}, Month: {row['month']}, Amount: {row['actual']}")
    
    return result
