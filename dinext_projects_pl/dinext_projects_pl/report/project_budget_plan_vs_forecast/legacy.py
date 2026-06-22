# Copyright (c) 2025, Dinord and contributors
# DEAD CODE - not imported anywhere
import frappe
import traceback
from frappe.utils import flt, cint, add_days

def get_actual_data(filters):
    """Получает фактические данные из GL Entry с учетом фильтров"""
    try:
        frappe.log("=== GET ACTUAL DATA START ===")
        frappe.log(f"Filters for actual data: {filters}")
        
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
        
        frappe.log(f"Date range: {start_date} to {end_date}")
        frappe.log(f"Company: {company}")
        
        # Базовые фильтры
        if filters.get("project"):
            conditions.append("gle.project = %(project)s")
            filter_values["project"] = filters.get("project")
            frappe.log(f"Project filter: {filters.get('project')}")
        
        # Фильтр по cost_center (прямой, как было)
        if filters.get("cost_center"):
            conditions.append("gle.cost_center = %(cost_center)s")
            filter_values["cost_center"] = filters.get("cost_center")
            frappe.log(f"Cost Center filter (direct): {filters.get('cost_center')}")
        
        # Фильтр по business_area (прямой, как было)
        if filters.get("business_area"):
            conditions.append("gle.business_area = %(business_area)s")
            filter_values["business_area"] = filters.get("business_area")
            frappe.log(f"Business Area filter (direct): {filters.get('business_area')}")
        
        # Фильтр project_portfolio работает через EXISTS
        if filters.get("project_portfolio"):
            conditions.append("""
                EXISTS (
                    SELECT 1 FROM `tabProject` p 
                    WHERE p.name = gle.project 
                    AND p.custom_project_portfolio = %(project_portfolio)s
                )
            """)
            filter_values["project_portfolio"] = filters.get("project_portfolio")
            frappe.log(f"Project Portfolio filter: {filters.get('project_portfolio')}")
        
        where_clause = " AND ".join(conditions)
        
        frappe.log(f"SQL conditions: {where_clause}")
        
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
        
        frappe.log(f"Actual data query returned {len(actual_data)} rows")
        
        # Логируем несколько примеров для проверки
        if actual_data:
            frappe.log(f"Sample actual data (first 5 rows):")
            for i, row in enumerate(actual_data[:5]):
                frappe.log(f"  Row {i+1}: Account={row.get('account', 'Unknown')}, "
                          f"{int(row.get('year', 0))}-{int(row.get('month', 0)):02d}, "
                          f"actual={flt(row.get('actual', 0))}")
            
            # Также логируем статистику
            total_actual = sum(flt(row.get('actual', 0)) for row in actual_data)
            frappe.log(f"Total actual amount: {total_actual}")
        else:
            frappe.log("WARNING: No actual data found!")
            
            # Проверяем, есть ли вообще записи в GL Entry для периода
            check_query = """
                SELECT COUNT(*) as cnt 
                FROM `tabGL Entry` 
                WHERE posting_date BETWEEN %(start_date)s AND %(end_date)s
                AND is_cancelled = 0
                AND company = %(company)s
            """
            check_result = frappe.db.sql(check_query, filter_values, as_dict=1)
            frappe.log(f"Total GL Entry records for period: {check_result[0].get('cnt', 0)}")
        
        frappe.log("=== GET ACTUAL DATA END ===")
        
        return actual_data or []
    except Exception as e:
        frappe.log(f"Error in get_actual_data: {str(e)}")
        frappe.log_error(f"Error in get_actual_data: {traceback.format_exc()}")
        return []

def combine_budget_and_actual_data(budget_data, actual_data, accounts_by_name, filters):
    """Объединяет бюджетные и фактические данные"""
    frappe.log("=== COMBINE DATA START ===")
    frappe.log(f"Budget data rows: {len(budget_data)}, Actual data rows: {len(actual_data)}")
    
    combined = {}
    
    # Сначала собираем все счета, которые имеют реальные данные
    accounts_with_data = set()
    
    # Обрабатываем бюджетные данные
    frappe.log(f"Processing {len(budget_data)} budget rows")
    for row in budget_data:
        account = row['account']
        period_key = "{0}_{1:02d}".format(int(row['year']), int(row['month']))
        
        if account not in combined:
            acc_info = accounts_by_name.get(account, {})
            combined[account] = {
                "account": account,
                "parent_account": acc_info.get("parent_account", ""),
                "is_group": acc_info.get("is_group", 0),
                "root_type": acc_info.get("root_type", ""),
                "has_value": False,
                "is_leaf": False,
                "is_aggregated": False,
                "has_own_data": False
            }
        
        combined[account][f"plan_{period_key}"] = flt(row['plan'])
        combined[account][f"forecast_{period_key}"] = flt(row['forecast'])
        
        if flt(row['plan']) != 0 or flt(row['forecast']) != 0:
            combined[account]["has_value"] = True
            combined[account]["is_leaf"] = True
            combined[account]["has_own_data"] = True
            accounts_with_data.add(account)
    
    frappe.log(f"After budget processing: {len(combined)} accounts")
    
    # Обрабатываем фактические данные
    frappe.log(f"Processing {len(actual_data)} actual rows")
    for row in actual_data:
        account = row['account']
        period_key = "{0}_{1:02d}".format(int(row['year']), int(row['month']))
        
        if account not in combined:
            acc_info = accounts_by_name.get(account, {})
            combined[account] = {
                "account": account,
                "parent_account": acc_info.get("parent_account", ""),
                "is_group": acc_info.get("is_group", 0),
                "root_type": acc_info.get("root_type", ""),
                "has_value": False,
                "is_leaf": False,
                "is_aggregated": False,
                "has_own_data": False
            }
        
        combined[account][f"actual_{period_key}"] = flt(row['actual'])
        
        if flt(row['actual']) != 0:
            combined[account]["has_value"] = True
            combined[account]["is_leaf"] = True
            combined[account]["has_own_data"] = True
            accounts_with_data.add(account)
    
    frappe.log(f"After actual processing: {len(combined)} accounts total")
    frappe.log(f"Accounts with own data: {len(accounts_with_data)}")
    frappe.log("=== COMBINE DATA END ===")
    
    return combined

def add_account_hierarchy(account, all_accounts, combined_data, data, indent):
    """Добавляет счет и его дочерние счета в данные"""
    # Получаем данные для текущего счета
    row_data = combined_data.get(account.name, {
        "account": account.name,
        "account_name": account.account_name,
        "parent_account": account.parent_account,
        "is_group": account.is_group,
        "root_type": account.root_type,
        "has_value": False,
        "is_leaf": False,
        "is_aggregated": False,
        "has_own_data": False
    })
    
    row_data["indent"] = indent
    
    # Добавляем счет в данные
    data.append(row_data)
    
    # Добавляем дочерние счета
    child_accounts = [acc for acc in all_accounts if acc.parent_account == account.name]
    for child in child_accounts:
        add_account_hierarchy(child, all_accounts, combined_data, data, indent + 1)

def accumulate_values_through_all_parents(data, parent_children_map, filters):
    """Правильная агрегация значений по иерархии с учетом ТИПОВ данных"""
    frappe.log("=== ACCUMULATE VALUES START (DATA-TYPE AWARE VERSION) ===")
    
    if not data:
        return data
    
    # Создаем словарь для быстрого доступа
    data_by_account = {row["account"]: row for row in data}
    
    # Получаем все ключи периодов из данных
    period_keys = set()
    for row in data:
        for key in row.keys():
            if key.startswith('plan_'):
                period_keys.add(key[5:])
            elif key.startswith('forecast_'):
                period_keys.add(key[9:])
            elif key.startswith('actual_'):
                period_keys.add(key[7:])
    
    frappe.log(f"Found period keys: {sorted(list(period_keys))}")
    
    # Шаг 1: Находим максимальный уровень вложенности
    max_indent = max(row.get("indent", 0) for row in data)
    
    # Шаг 2: Проходим снизу вверх
    for current_indent in range(max_indent, -1, -1):
        nodes_at_level = [row for row in data if row.get("indent", 0) == current_indent]
        
        for row in nodes_at_level:
            account_name = row["account"]
            
            # Получаем детей этого узла
            children = parent_children_map.get(account_name, [])
            if not children:
                continue  # Листовой узел
            
            # Для КАЖДОГО периода и КАЖДОГО типа данных отдельно
            node_original_data = {}
            for period_key in period_keys:
                for prefix in ['plan_', 'forecast_', 'actual_']:
                    key = f"{prefix}{period_key}"
                    node_original_data[key] = flt(row.get(key, 0))
            
            data_updated = False
            
            for period_key in period_keys:
                for prefix in ['plan_', 'forecast_', 'actual_']:
                    key = f"{prefix}{period_key}"
                    
                    current_value = flt(row.get(key, 0))
                    
                    # Если у узла уже есть значение и есть флаг has_own_data, оставляем
                    if current_value != 0 and row.get("has_own_data"):
                        continue
                    
                    # У узла нет собственных данных - агрегируем от детей
                    total_from_children = 0
                    for child in children:
                        child_name = child.name if hasattr(child, 'name') else child
                        child_row = data_by_account.get(child_name)
                        if not child_row:
                            continue
                        
                        child_value = flt(child_row.get(key, 0))
                        if child_value != 0:
                            total_from_children += child_value
                    
                    # Если от детей есть данные, добавляем их
                    if total_from_children != 0:
                        new_value = current_value + total_from_children
                        row[key] = new_value
                        data_updated = True
                        frappe.log(f"  {account_name or 'Unknown'}: {key} = {flt(current_value)} + {flt(total_from_children)} = {flt(new_value)}")
            
            if data_updated:
                row["has_value"] = True
                if not row.get("has_own_data"):
                    row["is_aggregated"] = True
                frappe.log(f"Account {account_name} updated with data from children")
    
    # Шаг 3: Обновляем флаги
    for row in data:
        account_name = row["account"]
        has_any_data = False
        
        for period_key in period_keys:
            for prefix in ['plan_', 'forecast_', 'actual_']:
                key = f"{prefix}{period_key}"
                if flt(row.get(key, 0)) != 0:
                    has_any_data = True
                    break
            if has_any_data:
                break
        
        row["has_value"] = has_any_data
        
        if has_any_data and not row.get("has_own_data"):
            children = parent_children_map.get(account_name, [])
            if children:
                row["is_aggregated"] = True
    
    # Отладочная информация
    frappe.log("=== FINAL HIERARCHY (WITH ACTUAL DATA) ===")
    important_accounts = [
        'Доход - D', 
        'Выручка от реализации - D', 
        'Работы / услуги - D',
        'Расход - D',
        'Работы / услуги (расход) - D',
        'Внутренняя команда (Трудозатраты) - D',
        'Затраты на капитал - D'
    ]
    
    for account_name in important_accounts:
        row = data_by_account.get(account_name)
        if not row:
            continue
        
        has_actual_data = False
        for period_key in period_keys:
            key = f"actual_{period_key}"
            if flt(row.get(key, 0)) != 0:
                has_actual_data = True
                break
        
        if has_actual_data or row.get("has_value"):
            frappe.log(f"{account_name}:")
            frappe.log(f"  has_own_data: {row.get('has_own_data', False)}")
            frappe.log(f"  is_aggregated: {row.get('is_aggregated', False)}")
            
            for period_key in sorted(list(period_keys)):
                for prefix in ['plan_', 'forecast_', 'actual_']:
                    key = f"{prefix}{period_key}"
                    value = flt(row.get(key, 0))
                    if value != 0:
                        frappe.log(f"  {key}: {value}")
    
    frappe.log("=== ACCUMULATE VALUES END ===")
    return data
