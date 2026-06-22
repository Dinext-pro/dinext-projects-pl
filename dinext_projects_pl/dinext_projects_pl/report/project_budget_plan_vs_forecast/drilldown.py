# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from collections import defaultdict
from frappe import _

from .budget_loader import get_accounts, process_project_data
from .hierarchy import build_hierarchy_for_project

@frappe.whitelist()    
def get_budget_details(account, year, month, data_type='plan', project=None, project_portfolio=None, cost_center=None, business_area=None, company=None):
    """
    Получает детальные данные по бюджету для drill-down с разбивкой по проектам
    Учитывает все фильтры из отчета
    """
    try:
        frappe.log(f"=== GET BUDGET DETAILS START ===")
        frappe.log(f"Account: {account}, Year: {year}, Month: {month}, Type: {data_type}")
        frappe.log(f"Filters - project: {project}, portfolio: {project_portfolio}, cost_center: {cost_center}, business_area: {business_area}")
        
        # Создаем фильтры как в основном отчете
        filters = {
            "company": company or frappe.defaults.get_user_default("Company"),
            "from_year": year,
            "to_year": year,
            "from_month": month,
            "to_month": month,
            "view_type": "forecast_only" if data_type == 'forecast' else "plan_only",
            "show_zero_columns": 1,
            "enable_drill_down": 1,
            "project": project,
            "project_portfolio": project_portfolio,
            "cost_center": cost_center,
            "business_area": business_area
        }
        
        frappe.log(f"Filters for process_project_data: {filters}")
        
        # Получаем иерархию счетов
        accounts = get_accounts(filters)
        
        # Строим parent_children_map для иерархии
        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)
        
        # Получаем всех детей нужного счета (включая его самого)
        child_accounts = frappe.db.sql("""
            SELECT name 
            FROM `tabAccount` 
            WHERE lft >= (SELECT lft FROM `tabAccount` WHERE name = %s)
                AND rgt <= (SELECT rgt FROM `tabAccount` WHERE name = %s)
                AND company = %s
        """, (account, account, filters["company"]), as_dict=1)
        
        account_names = [a.name for a in child_accounts]
        frappe.log(f"Account tree for {account}: {account_names}")
        
        # Находим проекты с данными с учетом всех фильтров
        projects_query = """
            SELECT DISTINCT pb.pb_project as project
            FROM `tabProject Budget Amount` pba
            INNER JOIN `tabProject Budget` pb ON pba.parent = pb.name
            LEFT JOIN `tabProject` p ON pb.pb_project = p.name
            WHERE pb.pb_account IN %(accounts)s
                AND pba.pba_year = %(year)s
                AND pba.pba_month = %(month)s
        """
        
        params = {
            "accounts": tuple(account_names),
            "year": int(year),
            "month": int(month)
        }
        
        if project:
            projects_query += " AND pb.pb_project = %(project)s"
            params["project"] = project
        
        if project_portfolio:
            projects_query += " AND p.custom_project_portfolio = %(project_portfolio)s"
            params["project_portfolio"] = project_portfolio
        
        frappe.log(f"Projects query: {projects_query}")
        frappe.log(f"Query params: {params}")
        
        project_results = frappe.db.sql(projects_query, params, as_dict=1)
        projects_to_process = [p["project"] for p in project_results]
        
        frappe.log(f"Projects to process: {projects_to_process}")
        
        if not projects_to_process:
            return []
        
        all_results = []
        
        for proj in projects_to_process:
            frappe.log(f"=== Processing project {proj} ===")
            
            # Получаем сырые данные для проекта через ту же функцию, что и в отчете
            project_raw_data = process_project_data(proj, filters)
            
            if not project_raw_data:
                frappe.log(f"No raw data for project {proj}")
                continue
            
            frappe.log(f"Project {proj} raw data: {len(project_raw_data)} rows")
            for row in project_raw_data:
                frappe.log(f"  {row['account']} {row['year']}-{row['month']:02d}: plan={row['plan']}, forecast={row['forecast']} ({'DIRECT' if row.get('has_own_data') else 'AGGREGATED'})")
            
            # Строим иерархию для этого проекта
            project_hierarchy = build_hierarchy_for_project(
                project_raw_data, 
                accounts, 
                parent_children_map
            )
            
            # Берем из иерархии данные для нужного счета
            period_key = f"{int(year)}_{int(month):02d}"
            
            if account in project_hierarchy and period_key in project_hierarchy[account]['data']:
                account_data = project_hierarchy[account]['data'][period_key]
                amount = account_data['forecast'] if data_type == 'forecast' else account_data['plan']
                
                if amount != 0:
                    all_results.append({
                        "project": proj,
                        "account": account,
                        "year": int(year),
                        "month": int(month),
                        "amount": amount,
                        "amount_type": _("Plan") if data_type == 'plan' else _("Forecast")
                    })
                    frappe.log(f"Project {proj}: amount={amount} (from hierarchy)")
            else:
                frappe.log(f"Project {proj}: no data for account {account} in hierarchy")
        
        frappe.log(f"Total results: {len(all_results)} records")
        return all_results
        
    except Exception as e:
        frappe.log(f"Error in get_budget_details: {str(e)}")
        frappe.log_error(f"Error in get_budget_details: {traceback.format_exc()}")
        return []