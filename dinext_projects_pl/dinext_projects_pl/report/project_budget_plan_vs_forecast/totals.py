# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate
from collections import defaultdict

def apply_forecast_actual_logic(data, filters):
    """
    Применяет логику для режима "Прогноз и факт":
    - Для прошедших месяцев: показываем только факт (actual)
    - Для текущего и будущих месяцев: показываем только прогноз (forecast)
    """
    if not data:
        return data
    
    # Получаем текущую дату
    current_date = getdate(today())
    current_year = current_date.year
    current_month = current_date.month
    
    frappe.log(f"Applying forecast/actual logic. Current date: {current_date}")
    frappe.log(f"Current year/month: {current_year}/{current_month}")
    
    # Проходим по всем строкам данных
    for row in data:
        # Получаем все ключи колонок
        for key in list(row.keys()):
            if key.startswith('forecast_'):
                parts = key.split('_')
                if len(parts) == 3:
                    try:
                        year = int(parts[1])
                        month = int(parts[2])
                        
                        if year < current_year or (year == current_year and month < current_month):
                            old_value = row[key]
                            row[key] = 0
                            if old_value != 0:
                                frappe.log(f"Zeroed forecast for past month: {key} (was {old_value})")
                    except (ValueError, IndexError):
                        continue
            elif key.startswith('actual_'):
                parts = key.split('_')
                if len(parts) == 3:
                    try:
                        year = int(parts[1])
                        month = int(parts[2])
                        
                        if year > current_year or (year == current_year and month >= current_month):
                            old_value = row[key]
                            row[key] = 0
                            if old_value != 0:
                                frappe.log(f"Zeroed actual for future month: {key} (was {old_value})")
                    except (ValueError, IndexError):
                        continue
    
    return data

def add_row_totals(data, filters, columns):
    """Добавляет тоталы по строкам с правильной логикой - только по отображаемым колонкам"""
    view_type = filters.get("view_type", "forecast_actual")
    show_plan = filters.get("show_plan")
    
    # Получаем текущую дату для режима forecast_actual
    current_date = getdate(today())
    current_year = current_date.year
    current_month = current_date.month
    
    # Собираем список отображаемых колонок
    display_columns = []
    for col in columns:
        fieldname = col["fieldname"]
        if fieldname.startswith('plan_') or fieldname.startswith('forecast_') or fieldname.startswith('actual_'):
            display_columns.append(fieldname)
    
    frappe.log(f"Display columns for totals: {len(display_columns)} columns")
    
    for row in data:
        total_plan = 0
        total_exp = 0
        total_fct = 0
        total_exp_fct = 0
        
        # Проходим только по отображаемым колонкам
        for fieldname in display_columns:
            value = flt(row.get(fieldname, 0))
            
            if fieldname.startswith('plan_'):
                total_plan += value
                
            elif fieldname.startswith('forecast_'):
                total_exp += value
                
                if view_type == "forecast_actual":
                    parts = fieldname.split('_')
                    if len(parts) == 3:
                        try:
                            year = int(parts[1])
                            month = int(parts[2])
                            if year > current_year or (year == current_year and month >= current_month):
                                total_exp_fct += value
                        except (ValueError, IndexError):
                            continue
                elif view_type == "forecast_only":
                    total_exp_fct += value
                    
            elif fieldname.startswith('actual_'):
                total_fct += value
                
                if view_type == "forecast_actual":
                    parts = fieldname.split('_')
                    if len(parts) == 3:
                        try:
                            year = int(parts[1])
                            month = int(parts[2])
                            if year < current_year or (year == current_year and month < current_month):
                                total_exp_fct += value
                        except (ValueError, IndexError):
                            continue
                elif view_type == "actual_only":
                    total_exp_fct += value
        
        # Устанавливаем отдельные тоталы в зависимости от настроек
        if show_plan:
            row["total_plan"] = total_plan
        
        if view_type == "forecast_actual":
            row["total_exp_fct"] = total_exp_fct
        elif view_type == "forecast_only":
            row["total_exp"] = total_exp_fct
        elif view_type == "actual_only":
            row["total_fct"] = total_exp_fct
    
    return data

def add_profit_row(data, columns, filters):
    """Добавляет строку с прибылью и рентабельностью с расчетом по месяцам"""
    if not data:
        return data
    
    view_type = filters.get("view_type", "forecast_actual")
    show_plan = filters.get("show_plan")
    
    # Создаем словарь для быстрого доступа
    data_by_account = {row["account"]: row for row in data}
    
    # Корневые узлы отчёта — строки верхнего уровня дерева после rollup (indent 0).
    root_income_nodes = []
    root_expense_nodes = []

    for row in data:
        if row.get("is_profit_row") or row.get("is_profitability_row"):
            continue

        if cint(row.get("indent", 0)) != 0:
            continue

        if row.get("root_type") == "Income":
            root_income_nodes.append(row["account"])
        elif row.get("root_type") == "Expense":
            root_expense_nodes.append(row["account"])
    
    frappe.log(f"Root income nodes: {root_income_nodes}")
    frappe.log(f"Root expense nodes: {root_expense_nodes}")
    
    # Собираем все возможные месячные колонки
    monthly_columns = []
    plan_columns = []
    forecast_columns = []
    actual_columns = []
    
    for col in columns:
        fieldname = col["fieldname"]
        if fieldname.startswith('plan_'):
            monthly_columns.append(fieldname)
            plan_columns.append(fieldname)
        elif fieldname.startswith('forecast_'):
            monthly_columns.append(fieldname)
            forecast_columns.append(fieldname)
        elif fieldname.startswith('actual_'):
            monthly_columns.append(fieldname)
            actual_columns.append(fieldname)
    
    # Словари для суммирования по месяцам
    income_by_column = defaultdict(float)
    expense_by_column = defaultdict(float)
    
    # Суммируем доходы по месяцам
    for account_name in root_income_nodes:
        row = data_by_account.get(account_name)
        if not row:
            continue
        
        for col in monthly_columns:
            income_by_column[col] += flt(row.get(col, 0))
    
    # Суммируем расходы по месяцам
    for account_name in root_expense_nodes:
        row = data_by_account.get(account_name)
        if not row:
            continue
        
        for col in monthly_columns:
            expense_by_column[col] += flt(row.get(col, 0))
    
    # Строка с валовой прибылью
    profit_row = {
        "account": _("Gross Profit"),
        "indent": 0,
        "is_group": 0,
        "parent_account": "",
        "has_value": True,
        "is_profit_row": True,
        "root_type": "Profit"
    }
    
    # Строка с рентабельностью
    profitability_row = {
        "account": _("Profitability (%)"),
        "indent": 1,
        "is_group": 0,
        "parent_account": "",
        "has_value": True,
        "is_profitability_row": True,
        "root_type": "Profitability"
    }
    
    # Рассчитываем прибыль и рентабельность для каждой месячной колонки
    for col in monthly_columns:
        income = income_by_column.get(col, 0)
        expense = expense_by_column.get(col, 0)
        profit = income - expense
        
        profit_row[col] = profit
        
        profitability = 0
        if income != 0:
            profitability = (profit / income) * 100
        
        profitability_row[col] = flt(profitability, 1)
    
    # Рассчитываем тоталы
    total_income_plan = sum(income_by_column.get(col, 0) for col in plan_columns)
    total_expense_plan = sum(expense_by_column.get(col, 0) for col in plan_columns)
    
    total_columns = []
    if view_type == "forecast_actual":
        current_date = getdate(today())
        current_year = current_date.year
        current_month = current_date.month
        
        for col in forecast_columns + actual_columns:
            parts = col.split('_')
            if len(parts) == 3:
                try:
                    year = int(parts[1])
                    month = int(parts[2])
                    
                    if col.startswith('forecast_'):
                        if year > current_year or (year == current_year and month >= current_month):
                            total_columns.append(col)
                    elif col.startswith('actual_'):
                        if year < current_year or (year == current_year and month < current_month):
                            total_columns.append(col)
                except (ValueError, IndexError):
                    continue
    elif view_type == "forecast_only":
        total_columns = forecast_columns
    elif view_type == "actual_only":
        total_columns = actual_columns
    
    total_income_exp_fct = sum(income_by_column.get(col, 0) for col in total_columns)
    total_expense_exp_fct = sum(expense_by_column.get(col, 0) for col in total_columns)
    
    # Устанавливаем тоталы для строки прибыли
    if show_plan:
        profit_row["total_plan"] = total_income_plan - total_expense_plan
    
    if view_type == "forecast_actual":
        profit_row["total_exp_fct"] = total_income_exp_fct - total_expense_exp_fct
    elif view_type == "forecast_only":
        profit_row["total_exp"] = total_income_exp_fct - total_expense_exp_fct
    elif view_type == "actual_only":
        profit_row["total_fct"] = total_income_exp_fct - total_expense_exp_fct
    
    # Устанавливаем тоталы для строки рентабельности
    if show_plan:
        if total_income_plan != 0:
            profitability_row["total_plan"] = flt(
                ((total_income_plan - total_expense_plan) / total_income_plan) * 100, 
                1
            )
        else:
            profitability_row["total_plan"] = 0
    
    if view_type == "forecast_actual":
        if total_income_exp_fct != 0:
            profitability_row["total_exp_fct"] = flt(
                ((total_income_exp_fct - total_expense_exp_fct) / total_income_exp_fct) * 100,
                1
            )
        else:
            profitability_row["total_exp_fct"] = 0
    elif view_type == "forecast_only":
        if total_income_exp_fct != 0:
            profitability_row["total_exp"] = flt(
                ((total_income_exp_fct - total_expense_exp_fct) / total_income_exp_fct) * 100,
                1
            )
        else:
            profitability_row["total_exp"] = 0
    elif view_type == "actual_only":
        if total_income_exp_fct != 0:
            profitability_row["total_fct"] = flt(
                ((total_income_exp_fct - total_expense_exp_fct) / total_income_exp_fct) * 100,
                1
            )
        else:
            profitability_row["total_fct"] = 0
    
    # Добавляем строки в данные
    data.append(profit_row)
    data.append(profitability_row)
    
    frappe.log(f"Profit row added. Monthly profit values calculated for {len(monthly_columns)} columns")
    
    return data
