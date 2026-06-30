# Copyright (c) 2025, Dinord and contributors
import frappe
from .debug_utils import _report_debug
from frappe.utils import flt
from collections import defaultdict

def build_hierarchy_for_project(project_data, accounts, parent_children_map):
    """
    Строит иерархию для одного проекта
    Возвращает словарь {account: {period_key: {'plan': value, 'forecast': value}}}
    """
    _report_debug(f"=== BUILD HIERARCHY FOR PROJECT START ===")
    
    # Создаем структуру для хранения данных проекта
    project_hierarchy = {}
    
    # 1. Инициализируем все счета из accounts
    for acc in accounts:
        project_hierarchy[acc.name] = {
            'account': acc.name,
            'parent_account': acc.parent_account,
            'is_group': acc.is_group,
            'root_type': acc.root_type,
            'data': defaultdict(lambda: {'plan': 0, 'forecast': 0}),
            'has_own_data': defaultdict(bool)  # Изменено: теперь по периодам!
        }
    
    # 2. Заполняем данными из project_data
    for row in project_data:
        account = row['account']
        period_key = f"{row['year']}_{row['month']:02d}"
        
        if account in project_hierarchy:
            project_hierarchy[account]['data'][period_key]['plan'] = flt(row['plan'])
            project_hierarchy[account]['data'][period_key]['forecast'] = flt(row['forecast'])
            # Отмечаем, что у этого счета есть СВОИ данные за этот период
            project_hierarchy[account]['has_own_data'][period_key] = True
            _report_debug(f"  Added OWN data to {account}: {period_key} plan={row['plan']}, forecast={row['forecast']}")
    
    # 3. Находим максимальный уровень вложенности
    max_indent = 0
    account_indent = {}
    
    # Сортируем аккаунты по lft
    sorted_accounts = sorted(accounts, key=lambda x: x.lft)
    
    for acc in sorted_accounts:
        indent = 0
        parent = acc.parent_account
        while parent:
            indent += 1
            parent_obj = next((a for a in accounts if a.name == parent), None)
            if not parent_obj:
                break
            parent = parent_obj.parent_account
        account_indent[acc.name] = indent
        max_indent = max(max_indent, indent)
    
    _report_debug(f"Account indents: {account_indent}")
    _report_debug(f"Starting aggregation from level {max_indent} to 0")
    
    # 4. Агрегируем снизу вверх
    for current_indent in range(max_indent, -1, -1):
        accounts_at_level = [acc.name for acc in accounts if account_indent.get(acc.name, 0) == current_indent]
        _report_debug(f"Processing level {current_indent}, accounts: {accounts_at_level}")
        
        for account_name in accounts_at_level:
            account_info = project_hierarchy.get(account_name)
            if not account_info:
                continue
            
            children = [acc.name for acc in accounts if acc.parent_account == account_name]
            
            if not children:
                continue
            
            # Собираем все периоды от детей
            all_child_periods = set()
            for child in children:
                if child in project_hierarchy:
                    all_child_periods.update(project_hierarchy[child]['data'].keys())
            
            _report_debug(f"  Account {account_name}, children: {children}")
            _report_debug(f"  Child periods: {all_child_periods}")
            
            for period_key in all_child_periods:
                # P&L semantics: for each value type, own value takes precedence.
                # If the parent has no own plan/forecast for the period, use child sum.
                total_plan = 0
                total_forecast = 0
                
                for child in children:
                    if child in project_hierarchy:
                        child_data = project_hierarchy[child]['data'].get(period_key, {'plan': 0, 'forecast': 0})
                        total_plan += child_data['plan']
                        total_forecast += child_data['forecast']
                
                current_plan = flt(account_info['data'][period_key]['plan'])
                current_forecast = flt(account_info['data'][period_key]['forecast'])
                updated = False

                if current_plan == 0 and total_plan != 0:
                    account_info['data'][period_key]['plan'] = total_plan
                    updated = True

                if current_forecast == 0 and total_forecast != 0:
                    account_info['data'][period_key]['forecast'] = total_forecast
                    updated = True

                if updated:
                    _report_debug(
                        f"  {account_name} filled missing values from children for {period_key}: "
                        f"own plan={current_plan}, children plan={total_plan}, "
                        f"own forecast={current_forecast}, children forecast={total_forecast}"
                    )
    
    _report_debug(f"=== BUILD HIERARCHY FOR PROJECT END ===")
    return project_hierarchy

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

def accumulate_all_values_upwards(data, parent_children_map, filters):
    """
    Аккумулирует ВСЕ типы данных (plan, forecast, actual) вверх по иерархии
    Как в старой версии кода
    """
    _report_debug("=== ACCUMULATE ALL VALUES UPWARDS START ===", filters)
    
    if not data:
        return data
    
    data_by_account = {row["account"]: row for row in data}
    
    # Получаем все ключи периодов
    period_keys = set()
    for row in data:
        for key in row.keys():
            if key.startswith('plan_'):
                period_keys.add(key[5:])
            elif key.startswith('forecast_'):
                period_keys.add(key[9:])
            elif key.startswith('actual_'):
                period_keys.add(key[7:])
    
    # Находим максимальный уровень вложенности
    max_indent = max(row.get("indent", 0) for row in data)
    
    # Проходим снизу вверх
    for current_indent in range(max_indent, -1, -1):
        nodes_at_level = [row for row in data if row.get("indent", 0) == current_indent]
        
        for row in nodes_at_level:
            account_name = row["account"]
            children = parent_children_map.get(account_name, [])
            
            if not children:
                continue
            
            # Для каждого периода и каждого типа данных
            for period_key in period_keys:
                for prefix in ['plan_', 'forecast_', 'actual_']:
                    key = f"{prefix}{period_key}"
                    
                    current_value = flt(row.get(key, 0))
                    
                    # Суммируем от детей
                    total_from_children = 0
                    for child in children:
                        child_name = child.name if hasattr(child, 'name') else child
                        child_row = data_by_account.get(child_name)
                        if child_row:
                            total_from_children += flt(child_row.get(key, 0))

                    # P&L rollup_fact_budget: actual = own + children
                    if prefix == "actual_":
                        combined = current_value + total_from_children
                        if combined != 0:
                            row[key] = combined
                            row["has_value"] = True
                            if total_from_children != 0:
                                row["is_aggregated"] = True
                        continue

                    # plan_/forecast_: own non-zero is not overwritten by children
                    if current_value != 0 and row.get("has_own_data"):
                        continue
                    
                    if total_from_children != 0:
                        row[key] = total_from_children
                        row["has_value"] = True
                        
                        if not row.get("has_own_data"):
                            row["is_aggregated"] = True
    
    _report_debug("=== ACCUMULATE ALL VALUES UPWARDS END ===", filters)
    return data
