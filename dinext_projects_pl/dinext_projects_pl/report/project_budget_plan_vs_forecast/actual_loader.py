# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from frappe.utils import flt, cint, add_days

from .filter_utils import apply_dimension_sql, append_dimension_sql

def get_actual_data_simple(filters):
    """Получает фактические данные из GL Entry + черновики если включено"""
    try:
        frappe.log("=== GET ACTUAL DATA SIMPLE START ===")
        
        # Существующий код получения данных из GL Entry
        company = filters.get("company") or frappe.defaults.get_user_default("Company")
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
        
        conditions = [
            "gle.posting_date BETWEEN %(start_date)s AND %(end_date)s",
            "gle.is_cancelled = 0",
            "gle.company = %(company)s"
        ]
        
        filter_values = {
            "start_date": start_date,
            "end_date": end_date,
            "company": company
        }
        
        apply_dimension_sql(conditions, filter_values, filters, "project", "gle.project")
        apply_dimension_sql(conditions, filter_values, filters, "cost_center", "gle.cost_center")
        apply_dimension_sql(conditions, filter_values, filters, "business_area", "gle.business_area")

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
        
        where_clause = " AND ".join(conditions)
        
        actual_data = frappe.db.sql("""
            SELECT
                gle.account,
                YEAR(gle.posting_date) as year,
                MONTH(gle.posting_date) as month,
                CASE
                    WHEN a.root_type = 'Income' THEN 
                        ROUND(SUM(gle.credit - gle.debit), 0)
                    WHEN a.root_type = 'Expense' THEN 
                        ABS(ROUND(SUM(gle.debit - gle.credit), 0))
                    ELSE 
                        ROUND(SUM(gle.debit - gle.credit), 0)
                END as actual
            FROM `tabGL Entry` gle
            INNER JOIN `tabAccount` a ON gle.account = a.name
            WHERE {where_clause}
            GROUP BY gle.account, YEAR(gle.posting_date), MONTH(gle.posting_date), a.root_type
            ORDER BY YEAR(gle.posting_date), MONTH(gle.posting_date), gle.account
        """.format(where_clause=where_clause), filter_values, as_dict=1)
        
        # НОВАЯ ЛОГИКА: добавляем черновики если включен фильтр
        if filters.get("include_future_actual"):
            frappe.log("Including draft invoices in actual data")
            draft_data = get_draft_invoice_data(filters)
            actual_data = merge_actual_and_draft(actual_data, draft_data)
            frappe.log(f"After merging: {len(actual_data)} rows (GL: {len(actual_data) - len(draft_data)}, Drafts: {len(draft_data)})")
        
        frappe.log(f"Actual data simple query returned {len(actual_data)} rows")
        return actual_data or []
        
    except Exception as e:
        frappe.log(f"Error in get_actual_data_simple: {str(e)}")
        frappe.log_error(f"Error in get_actual_data_simple: {traceback.format_exc()}")
        return []
        
def get_draft_invoice_data(filters):
    """Получает суммы из черновиков Sales и Purchase Invoice с учетом всех фильтров"""
    
    company = filters.get("company") or frappe.defaults.get_user_default("Company")
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
    
    draft_data = []
    
    # 1. Sales Invoice (доходы)
    sales_params = {
        "company": company,
        "start_date": start_date,
        "end_date": end_date
    }
    
    sales_query = """
        SELECT 
            sii.income_account as account,
            YEAR(si.posting_date) as year,
            MONTH(si.posting_date) as month,
            SUM(sii.amount) as amount
        FROM `tabSales Invoice` si
        INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
        WHERE si.docstatus = 0
            AND si.company = %(company)s
            AND si.posting_date BETWEEN %(start_date)s AND %(end_date)s
    """
    
    # Фильтр по проекту / измерениям
    sales_query = append_dimension_sql(sales_query, sales_params, filters, "project", "si.project")
    sales_query = append_dimension_sql(sales_query, sales_params, filters, "cost_center", "sii.cost_center")
    sales_query = append_dimension_sql(sales_query, sales_params, filters, "business_area", "si.custom_business_area")

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
    
    sales_query += " GROUP BY sii.income_account, YEAR(si.posting_date), MONTH(si.posting_date)"
    
    sales_drafts = frappe.db.sql(sales_query, sales_params, as_dict=1)
    
    frappe.log(f"Sales drafts raw data:")
    
    for row in sales_drafts:
        frappe.log(f"  account={row['account']}, year={row['year']}, month={row['month']}, amount={row['amount']}")
        draft_data.append({
            'account': row['account'],
            'year': row['year'],
            'month': row['month'],
            'actual': flt(row['amount'])
        })
    
    # 2. Purchase Invoice (расходы)
    purchase_params = {
        "company": company,
        "start_date": start_date,
        "end_date": end_date
    }
    
    purchase_query = """
        SELECT 
            pii.expense_account as account,
            YEAR(pi.posting_date) as year,
            MONTH(pi.posting_date) as month,
            SUM(pii.amount) as amount
        FROM `tabPurchase Invoice` pi
        INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE pi.docstatus = 0
            AND pi.company = %(company)s
            AND pi.posting_date BETWEEN %(start_date)s AND %(end_date)s
    """
    
    purchase_query = append_dimension_sql(purchase_query, purchase_params, filters, "project", "pii.project")
    purchase_query = append_dimension_sql(purchase_query, purchase_params, filters, "cost_center", "pii.cost_center")
    purchase_query = append_dimension_sql(purchase_query, purchase_params, filters, "business_area", "pi.custom_business_area")

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
    
    purchase_query += " GROUP BY pii.expense_account, YEAR(pi.posting_date), MONTH(pi.posting_date)"
    
    purchase_drafts = frappe.db.sql(purchase_query, purchase_params, as_dict=1)
    
    for row in purchase_drafts:
        draft_data.append({
            'account': row['account'],
            'year': row['year'],
            'month': row['month'],
            'actual': flt(row['amount'])
        })
    
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
