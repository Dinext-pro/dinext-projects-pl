# ТЕКУЩАЯ ВЕРСИЯ ТЕСТА НА 23.04.2026
# ДОБАВЛЕН ПОДСЧЕТ БУДУЩЕГО ПЛАНА + УЧЕТ АЛЛОКЕЙШН
#НОВАЯ ВЕРСИЯ ДЛЯ ТЕСТИРОВАНИЯ
#ВАРИАНТ 6 БУДУЩИЙ ФАКТ
# Copyright (c) 2025, Dinord and contributors
# For license information, please see license.txt
import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate, add_days, add_months, get_first_day, get_last_day, date_diff
from erpnext.accounts.report.financial_statements import filter_out_zero_value_rows
from collections import defaultdict
import traceback
from datetime import datetime

def execute(filters=None):
    if not filters:
        filters = {}
    
    frappe.log("=== START REPORT EXECUTION ===")
    frappe.log(f"ALL FILTERS: {filters}")
    
    validate_filters(filters)
    data = get_data(filters)
    
    frappe.log(f"Total data rows after get_data: {len(data)}")
    
    # Сначала получаем все колонки
    columns = get_columns(filters, data)
    
    # Применяем фильтрацию нулевых колонок если нужно
    if not filters.get("show_zero_columns"):
        columns = filter_zero_columns(columns, data)
    
    # Добавляем итоговые колонки
    columns = add_total_columns(columns, filters)
    
    # Теперь добавляем тоталы по строкам (после фильтрации колонок!)
    data = add_row_totals(data, filters, columns)
    
    # Добавляем строку с прибылью (после расчета тоталов!)
    data = add_profit_row(data, columns, filters)
    
    frappe.log(f"Final data rows: {len(data)}")
    frappe.log(f"Final columns: {[col['fieldname'] for col in columns]}")
    frappe.log("=== END REPORT EXECUTION ===")
    
    return columns, data

def validate_filters(filters):
    if not filters.get("from_year"):
        frappe.throw(_("Please select From Year"))
    if not filters.get("to_year"):
        frappe.throw(_("Please select To Year"))

def get_columns(filters, data):
    columns = [
        {
            "label": _("Account"),
            "fieldname": "account",
            "fieldtype": "Link",
            "options": "Account",
            "width": 300,
            "tree": True
        }
    ]
    
    from_year = cint(filters.get("from_year"))
    to_year = cint(filters.get("to_year"))
    show_plan = filters.get("show_plan")
    view_type = filters.get("view_type", "forecast_actual")
    
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    
    # Получаем текущую дату
    current_date = getdate(today())
    current_year = current_date.year
    current_month = current_date.month
    
    for year in range(from_year, to_year + 1):
        start_month = 1 if year > from_year else cint(filters.get("from_month", 1))
        end_month = 12 if year < to_year else cint(filters.get("to_month", 12))
        
        for month in range(start_month, end_month + 1):
            month_name = month_names[month]
            period_key = "{0}_{1:02d}".format(year, month)
            
            # Определяем является ли месяц прошедшим
            is_past_month = (year < current_year) or (year == current_year and month < current_month)
            
            # Всегда показываем план если включен чекбокс
            if show_plan:
                columns.append({
                    "label": _("{0} {1} Pl").format(month_name, year),  # План
                    "fieldname": "plan_{0}".format(period_key),
                    "fieldtype": "Currency",
                    "width": 120,
                    "precision": 0
                })
            
            # Логика для разных типов отображения
            if view_type == "forecast_actual":
                # Для прошедших месяцев показываем только факт
                if is_past_month:
                    columns.append({
                        "label": _("{0} {1} Fct").format(month_name, year),  # Факт
                        "fieldname": "actual_{0}".format(period_key),
                        "fieldtype": "Currency",
                        "width": 120,
                        "precision": 0
                    })
                # Для текущего и будущих месяцев показываем только прогноз
                else:
                    columns.append({
                        "label": _("{0} {1} Exp").format(month_name, year),  # Прогноз
                        "fieldname": "forecast_{0}".format(period_key),
                        "fieldtype": "Currency",
                        "width": 120,
                        "precision": 0
                    })
            elif view_type == "forecast_only":
                columns.append({
                    "label": _("{0} {1} Exp").format(month_name, year),  # Прогноз
                    "fieldname": "forecast_{0}".format(period_key),
                    "fieldtype": "Currency",
                    "width": 120,
                    "precision": 0
                })
            elif view_type == "actual_only":
                columns.append({
                    "label": _("{0} {1} Fct").format(month_name, year),  # Факт
                    "fieldname": "actual_{0}".format(period_key),
                    "fieldtype": "Currency",
                    "width": 120,
                    "precision": 0
                })
    
    return columns

def add_total_columns(columns, filters):
    """Добавляем итоговые колонки"""
    view_type = filters.get("view_type", "forecast_actual")
    show_plan = filters.get("show_plan")
    
    total_columns = []
    
    # Total Plan - только если show_plan = 1
    if show_plan:
        total_columns.append({
            "label": _("Total Plan"),
            "fieldname": "total_plan",
            "fieldtype": "Currency",
            "width": 120,
            "precision": 0
        })
    
    # Total Exp/Fct в зависимости от view_type
    if view_type == "forecast_actual":
        total_columns.append({
            "label": _("Total Exp/Fct"),
            "fieldname": "total_exp_fct",
            "fieldtype": "Currency",
            "width": 130,
            "precision": 0
        })
    elif view_type == "forecast_only":
        total_columns.append({
            "label": _("Total Exp"),
            "fieldname": "total_exp",
            "fieldtype": "Currency",
            "width": 120,
            "precision": 0
        })
    elif view_type == "actual_only":
        total_columns.append({
            "label": _("Total Fct"),
            "fieldname": "total_fct",
            "fieldtype": "Currency",
            "width": 120,
            "precision": 0
        })
    
    return columns + total_columns

def filter_zero_columns(columns, data):
    """
    Удаляет колонки месяцев, где ВСЕ значения равны 0
    Простая и надежная реализация
    """
    if not data or not columns:
        return columns
    
    frappe.log("=== FILTER ZERO COLUMNS START ===")
    frappe.log(f"Initial columns: {len(columns)}")
    
    # Создаем словарь для отслеживания ненулевых значений по колонкам
    column_has_values = {}
    
    # Инициализируем все колонки данных (кроме служебных и итоговых)
    for col in columns:
        fieldname = col["fieldname"]
        if fieldname not in ["account", "total_plan", "total_exp", "total_fct", "total_exp_fct"]:
            column_has_values[fieldname] = False
    
    # Проверяем каждую строку данных
    for row_idx, row in enumerate(data):
        for fieldname in column_has_values.keys():
            # Если уже нашли ненулевое значение, пропускаем
            if column_has_values[fieldname]:
                continue
            
            # Проверяем есть ли значение и не равно ли оно 0
            value = row.get(fieldname)
            if value is not None and flt(value) != 0:
                column_has_values[fieldname] = True
                frappe.log(f"Found non-zero in row {row_idx}, column {fieldname}: {value}")
    
    frappe.log(f"Column has values: {column_has_values}")
    
    # Фильтруем колонки
    filtered_columns = []
    
    for col in columns:
        fieldname = col["fieldname"]
        
        # Всегда оставляем служебные и итоговые колонки
        if fieldname in ["account", "total_plan", "total_exp", "total_fct", "total_exp_fct"]:
            filtered_columns.append(col)
        # Оставляем колонки с данными только если в них есть ненулевые значения
        elif column_has_values.get(fieldname, True):
            filtered_columns.append(col)
        else:
            frappe.log(f"Removing zero column: {fieldname}")
    
    frappe.log(f"Filtered columns: {len(filtered_columns)}")
    frappe.log("=== FILTER ZERO COLUMNS END ===")
    
    return filtered_columns

def get_task_hierarchy(project):
    """Получает иерархию задач для конкретного проекта"""
    if not project:
        return {}
    
    try:
        tasks = frappe.get_all("Task",
            filters={"project": project},
            fields=["name", "subject", "parent_task", "lft", "rgt"],
            order_by="lft"
        )
        
        # Создаем словарь для быстрого доступа
        task_dict = {}
        for task in tasks:
            task_dict[task.name] = {
                "name": task.name,
                "subject": task.subject,
                "parent_task": task.parent_task,
                "children": []
            }
        
        # Строим дерево иерархии
        for task in tasks:
            if task.parent_task and task.parent_task in task_dict:
                task_dict[task.parent_task]["children"].append(task_dict[task.name])
        
        frappe.log(f"Task hierarchy built for project {project}: {len(task_dict)} tasks")
        return task_dict
        
    except Exception as e:
        frappe.log(f"Error building task hierarchy for project {project}: {str(e)}")
        frappe.log_error(f"Error building task hierarchy: {traceback.format_exc()}")
        return {}

def aggregate_tasks_for_account_and_period(account_rows, task_hierarchy, period_key, data_type):
    """
    Агрегирует данные по Task для конкретного счета и периода с учетом иерархии
    """
    
    frappe.log(f"AGGREGATE TASKS: received {len(account_rows)} rows, data_type={data_type}")
    for i, row in enumerate(account_rows[:5]):
        frappe.log(f"  row {i}: task={row.get('task')}, plan={row.get('plan')}, expected={row.get('expected')}")
    try:
        # Собираем данные по Task для этого Account, периода и типа данных
        task_data_map = {}
        
        for row in account_rows:
            if row.get('task'):
                year = int(row['pba_year'])
                month = int(row['pba_month'])
                row_period_key = f"{year}_{month:02d}"
                
                if row_period_key != period_key:
                    continue
                
                task = row['task']
                
                if task not in task_data_map:
                    task_data_map[task] = {'plan': 0, 'forecast': 0}
                
                task_data_map[task]['plan'] += flt(row.get('plan', 0))
                task_data_map[task]['forecast'] += flt(row.get('forecast', 0))
        
        if not task_data_map:
            return 0
            
        # Добавьте логирование здесь
        frappe.log(f"Task data map:")
        for task, values in task_data_map.items():
            frappe.log(f"  {task}: plan={values['plan']}, forecast={values['forecast']}")
        
        # Находим корневые Task
        root_tasks = []
        for task in task_data_map.keys():
            task_node = task_hierarchy.get(task, {})
            if not task_node.get('parent_task'):
                root_tasks.append(task)
            elif task_node.get('parent_task') not in task_data_map:
                root_tasks.append(task)
        
        # Функция для агрегации Task с учетом иерархии
        def aggregate_task_data(task_name, visited=None):
            if visited is None:
                visited = set()
            
            if task_name in visited:
                return {'plan': 0, 'forecast': 0}
            
            visited.add(task_name)
            
            task_node = task_hierarchy.get(task_name, {})
            children = task_node.get('children', [])
            
            # Проверяем, есть ли у этой Task собственные данные для нужного типа
            has_own_data = False
            if task_name in task_data_map:
                if data_type == 'plan':
                    has_own_data = flt(task_data_map[task_name]['plan']) != 0
                else:
                    has_own_data = flt(task_data_map[task_name]['forecast']) != 0
            
            result = {'plan': 0, 'forecast': 0}
            
            if has_own_data:
                # У Task есть собственные данные - используем их
                result['plan'] = flt(task_data_map[task_name]['plan'])
                result['forecast'] = flt(task_data_map[task_name]['forecast'])
            else:
                # У Task нет данных - суммируем данные от детей
                for child in children:
                    child_name = child.get('name')
                    child_data = aggregate_task_data(child_name, visited)
                    
                    result['plan'] += flt(child_data['plan'])
                    result['forecast'] += flt(child_data['forecast'])
                
                # Task в данных, но не в иерархии
                for data_task in task_data_map.keys():
                    if data_task not in task_hierarchy and task_hierarchy.get(data_task, {}).get('parent_task') == task_name:
                        result['plan'] += flt(task_data_map[data_task]['plan'])
                        result['forecast'] += flt(task_data_map[data_task]['forecast'])
            
            return result
        
        # Агрегируем все корневые Task
        total = 0
        
        for root_task in root_tasks:
            task_aggregated = aggregate_task_data(root_task)
            if data_type == 'plan':
                total += flt(task_aggregated['plan'])
            else:
                total += flt(task_aggregated['forecast'])
        
        # Task не в иерархии
        for task in task_data_map.keys():
            if task not in task_hierarchy and task not in root_tasks:
                if data_type == 'plan':
                    total += flt(task_data_map[task]['plan'])
                else:
                    total += flt(task_data_map[task]['forecast'])
        
        return total
    except Exception as e:
        frappe.log(f"Error in aggregate_tasks_for_account_and_period for period {period_key}, type {data_type}: {str(e)}")
        return 0

def get_cost_center_history(project, as_of_date=None):
    """
    Получает историю назначений Cost Center для проекта
    Возвращает список отсортированный по дате (самые свечие первые)
    """
    if not project:
        return []
    
    if as_of_date is None:
        as_of_date = today()
    
    history = frappe.db.sql("""
        SELECT 
            cct_cost_center as cost_center,
            cct_valid_from as valid_from
        FROM `tabCost Center Table`
        WHERE parent = %s
            AND cct_valid_from <= %s
        ORDER BY cct_valid_from DESC
    """, (project, as_of_date), as_dict=1)
    
    return history

def get_business_area_history(project, as_of_date=None):
    """
    Получает историю назначений Business Area для проекта
    Возвращает список отсортированный по дате (самые свечие первые)
    """
    if not project:
        return []
    
    if as_of_date is None:
        as_of_date = today()
    
    history = frappe.db.sql("""
        SELECT 
            business_area,
            percent,
            valid_from
        FROM `tabCost Business Area`
        WHERE parent = %s
            AND valid_from <= %s
        ORDER BY valid_from DESC, creation DESC
    """, (project, as_of_date), as_dict=1)
    
    return history

def get_active_settings_for_date(project, target_date):
    """
    Получает активные настройки Business Area на конкретную дату
    Важно: Для одна даты может быть несколько Business Area!
    """
    try:
        # Получаем ВСЕ активные Business Area на дату
        business_area_history = get_business_area_history(project, target_date)
        
        if not business_area_history:
            return {'business_areas': [], 'date': target_date}
        
        # Находим самую свежую дату из результатов
        latest_date = business_area_history[0].get('valid_from')
        
        # Собираем ВСЕ Business Area с этой датой
        active_business_areas = []
        for ba in business_area_history:
            if ba.get('valid_from') == latest_date:
                active_business_areas.append({
                    'business_area': ba.get('business_area'),
                    'percent': flt(ba.get('percent', 0)),
                    'valid_from': ba.get('valid_from')
                })
        
        return {
            'business_areas': active_business_areas,
            'date': target_date
        }
        
    except Exception as e:
        frappe.log(f"Error in get_active_settings_for_date: {str(e)}")
        return {'business_areas': [], 'date': target_date}

def get_active_cost_center_for_date(project, target_date):
    """
    Получает активный Cost Center на конкретную дату
    """
    if not project:
        return None
    
    try:
        history = get_cost_center_history(project, target_date)
        
        if not history:
            return None
        
        # Самый свежий Cost Center на эту дату
        return history[0].get('cost_center')
        
    except Exception as e:
        frappe.log(f"Error in get_active_cost_center_for_date: {str(e)}")
        return None
        
def get_cost_center_allocation(main_cost_center, target_date):
    """
    Получает активную аллокацию для главного Cost Center на дату
    Возвращает: dict с ключами 'name', 'valid_from', 'children' или None
    """
    if not main_cost_center:
        return None
    
    allocation = frappe.db.sql("""
        SELECT name, valid_from
        FROM `tabCost Center Allocation`
        WHERE main_cost_center = %s
            AND docstatus = 1
            AND valid_from <= %s
        ORDER BY valid_from DESC
        LIMIT 1
    """, (main_cost_center, target_date), as_dict=1)
    
    if not allocation:
        return None
    
    children = frappe.db.sql("""
        SELECT cost_center, percentage
        FROM `tabCost Center Allocation Percentage`
        WHERE parent = %s
    """, allocation[0].name, as_dict=1)
    
    if not children:
        return None
    
    return {
        'name': allocation[0].name,
        'valid_from': allocation[0].valid_from,
        'children': children
    }

def split_month_into_periods(project, year, month):
    """
    Разбивает месяц на периоды с одинаковыми настройками Business Area и Cost Center
    """
    try:
        year_int = int(year) if year else 0
        month_int = int(month) if month else 0
        
        if year_int == 0 or month_int == 0:
            return []
            
        month_start = f"{year_int}-{month_int:02d}-01"
        month_end = get_last_day(month_start)
        
        current_date = getdate(month_start)
        end_date = getdate(month_end)
        
        periods = []
        current_ba_settings = None
        current_cc = None
        
        while current_date <= end_date:
            current_date_str = str(current_date)
            
            # Получаем настройки на текущую дату
            ba_settings = get_active_settings_for_date(project, current_date_str)
            cc = get_active_cost_center_for_date(project, current_date_str)
            
            # Если настройки изменились или это первый день
            if (current_ba_settings is None or current_cc is None or 
                not are_settings_equal(current_ba_settings, ba_settings) or
                current_cc != cc):
                
                if len(periods) > 0:
                    # Завершаем предыдущий период
                    periods[-1]['end_date'] = str(add_days(current_date, -1))
                    periods[-1]['days'] = date_diff(
                        getdate(periods[-1]['end_date']), 
                        getdate(periods[-1]['start_date'])
                    ) + 1
                
                # Начинаем новый период
                periods.append({
                    'start_date': current_date_str,
                    'end_date': str(end_date),  # временно до конца месяца
                    'business_areas': ba_settings.get('business_areas', []),
                    'cost_center': cc,  # Добавляем Cost Center
                    'days': 0
                })
                current_ba_settings = ba_settings
                current_cc = cc
            
            current_date = add_days(current_date, 1)
        
        # Завершаем последний период
        if periods:
            periods[-1]['end_date'] = str(end_date)
            periods[-1]['days'] = date_diff(
                getdate(periods[-1]['end_date']), 
                getdate(periods[-1]['start_date'])
            ) + 1
        
        # Удаляем периоды без данных (ни BA ни CC могут быть важны в зависимости от фильтра)
        periods = [p for p in periods if p.get('business_areas') or p.get('cost_center')]
        
        return periods
        
    except Exception as e:
        frappe.log(f"Error in split_month_into_periods: {str(e)}")
        frappe.log(traceback.format_exc())
        return []
        
def are_settings_equal(settings1, settings2):
    """
    Проверяет, одинаковы ли настройки Business Area
    """
    bas1 = settings1.get('business_areas', [])
    bas2 = settings2.get('business_areas', [])
    
    if len(bas1) != len(bas2):
        return False
    
    # Сортируем для сравнения
    bas1_sorted = sorted(bas1, key=lambda x: x.get('business_area', ''))
    bas2_sorted = sorted(bas2, key=lambda x: x.get('business_area', ''))
    
    for ba1, ba2 in zip(bas1_sorted, bas2_sorted):
        if ba1.get('business_area') != ba2.get('business_area'):
            return False
        if abs(flt(ba1.get('percent', 0)) - flt(ba2.get('percent', 0))) > 0.01:
            return False
    
    return True

def calculate_allocation_for_month(project, year, month, total_amount, cost_center_filter=None, business_area_filter=None, apply_allocation=True):
    """
    Рассчитывает распределение суммы за месяц по динамическим настройкам
    Теперь корректно работает и с Cost Center и с Business Area
    """
    frappe.log(f"=== CALCULATE ALLOCATION: apply_allocation={apply_allocation}, type={type(apply_allocation)} ===")
    
    if not project:
        frappe.log(f"  No project provided for allocation calculation")
        return 0
    
    try:
        year_int = int(year) if year else 0
        month_int = int(month) if month else 0
        total_amount_float = flt(total_amount)
        
        if year_int == 0 or month_int == 0:
            frappe.log(f"  Invalid year/month: {year}/{month}")
            return 0
            
        frappe.log(f"  Calculating allocation for project {project}, {year_int}-{month_int:02d}")
        frappe.log(f"  Total amount: {total_amount_float}")
        frappe.log(f"  Filters - CC: '{cost_center_filter}', BA: '{business_area_filter}'")
        
        # Разбиваем месяц на периоды
        periods = split_month_into_periods(project, year_int, month_int)
        
        frappe.log(f"  Found {len(periods)} periods in month")
        
        if not periods:
            frappe.log(f"  No periods found for month, returning 0")
            return 0
        
        # Количество дней в месяце
        month_start = f"{year_int}-{month_int:02d}-01"
        month_end = get_last_day(month_start)
        total_days_in_month = date_diff(month_end, getdate(month_start)) + 1
        
        frappe.log(f"  Total days in month: {total_days_in_month}")
        
        if total_days_in_month <= 0:
            frappe.log(f"  Invalid total days in month")
            return 0
        
        allocated_amount = 0
        
        for i, period in enumerate(periods):
            period_days = int(period.get('days', 0))
            if period_days <= 0:
                continue
                
            # Доля периода в месяце
            period_ratio = period_days / total_days_in_month
            period_amount = total_amount_float * period_ratio
            
            period_cc = period.get('cost_center')
            business_areas = period.get('business_areas', [])
            
            frappe.log(f"  Period {i+1}: {period.get('start_date')} to {period.get('end_date')} ({period_days} days)")
            frappe.log(f"    Period ratio: {period_ratio:.4f}, Period amount: {period_amount:.2f}")
            frappe.log(f"    Period Cost Center: '{period_cc}'")
            
            # 1. Сначала применяем фильтр по Cost Center (если есть)
            amount_after_cc = 0
            
            if cost_center_filter:
                if apply_allocation:
                    # Проверяем, есть ли у period_cc аллокация
                    allocation = get_cost_center_allocation(period_cc, period.get('start_date'))
                    
                    if allocation:
                        # У родительского CC есть аллокация
                        frappe.log(f"    -> CC '{period_cc}' has allocation {allocation['name']} with {len(allocation['children'])} children")
                        
                        # Ищем дочерний CC, совпадающий с фильтром
                        matched = False
                        for child in allocation['children']:
                            if child['cost_center'] == cost_center_filter:
                                amount_after_cc = period_amount * (child['percentage'] / 100)
                                frappe.log(f"    -> CHILD MATCH! Child CC '{child['cost_center']}' ({child['percentage']}%) = {amount_after_cc:.2f}")
                                matched = True
                                break
                        
                        if not matched:
                            frappe.log(f"    -> NO CHILD MATCH: Filter CC '{cost_center_filter}' not found in allocation children")
                    else:
                        # Нет аллокации - прямое сравнение
                        if period_cc and period_cc == cost_center_filter:
                            amount_after_cc = period_amount
                            frappe.log(f"    -> CC MATCH (no allocation)! Period CC '{period_cc}' == Filter CC '{cost_center_filter}'")
                        elif period_cc:
                            frappe.log(f"    -> CC MISMATCH: Period CC '{period_cc}' != Filter CC '{cost_center_filter}'")
                        else:
                            frappe.log(f"    -> No CC in this period")
                else:
                    # Аллокация выключена - прямое сравнение
                    if period_cc and period_cc == cost_center_filter:
                        amount_after_cc = period_amount
                        frappe.log(f"    -> CC MATCH (allocation disabled)! Period CC '{period_cc}' == Filter CC '{cost_center_filter}'")
                    elif period_cc:
                        frappe.log(f"    -> CC MISMATCH: Period CC '{period_cc}' != Filter CC '{cost_center_filter}'")
                    else:
                        frappe.log(f"    -> No CC in this period")
            else:
                # Нет фильтра по CC - берем полную сумму периода
                amount_after_cc = period_amount
            
            # 2. Затем применяем фильтр по Business Area (если есть) к сумме после CC
            if business_area_filter and amount_after_cc != 0:
                matched_ba = False
                for ba in business_areas:
                    ba_name = ba.get('business_area')
                    ba_percent = flt(ba.get('percent', 0))
                    if ba_name and ba_name == business_area_filter and ba_percent > 0:
                        ba_amount = amount_after_cc * (ba_percent / 100)
                        allocated_amount += ba_amount
                        matched_ba = True
                        frappe.log(f"    -> BA MATCH! BA: '{ba_name}' ({ba_percent}%) applied to {amount_after_cc:.2f} = {ba_amount:.2f}")
                        break
                
                if not matched_ba:
                    frappe.log(f"    -> BA NOT FOUND: Filter BA '{business_area_filter}' not in period BAs")
            else:
                # Нет фильтра по BA - добавляем сумму как есть
                if amount_after_cc != 0:
                    allocated_amount += amount_after_cc
                    frappe.log(f"    -> Adding {amount_after_cc:.2f} (no BA filter), Total: {allocated_amount:.2f}")
        
        frappe.log(f"  Final allocated amount: {allocated_amount:.2f}")
        return allocated_amount
        
    except Exception as e:
        frappe.log(f"Error in calculate_allocation_for_month: {str(e)}")
        frappe.log(traceback.format_exc())
        return 0

def get_raw_budget_data_for_project(project, filters):
    """
    Получает сырые бюджетные данные для конкретного проекта с РАЗДЕЛЕНИЕМ по Task
    """
    try:
        frappe.log(f"=== GET RAW BUDGET DATA FOR PROJECT {project} START ===")
        
        final_conditions = []
        filter_values = {
            "from_year": filters.get("from_year"),
            "to_year": filters.get("to_year"),
            "project": project
        }
        
        # Добавляем фильтрацию по месяцам - ПРЕОБРАЗУЕМ В ЧИСЛА!
        from_month = cint(filters.get("from_month"))
        to_month = cint(filters.get("to_month"))
        
        if from_month:
            final_conditions.append("pba.pba_month >= %(from_month)s")
            filter_values["from_month"] = from_month
        
        if to_month:
            final_conditions.append("pba.pba_month <= %(to_month)s")
            filter_values["to_month"] = to_month
        
        # Фильтр по проекту (обязательный для этой функции)
        final_conditions.append("pb.pb_project = %(project)s")
        
        # Фильтр по портфолио (если указан)
        if filters.get("project_portfolio"):
            final_conditions.append("p.custom_project_portfolio = %(project_portfolio)s")
            filter_values["project_portfolio"] = filters.get("project_portfolio")
        
        where_clause = " AND ".join(final_conditions) if final_conditions else "1=1"
        
        sql_query = """
            SELECT 
                pb.pb_account,
                pb.pb_project as project,
                pbd.docname as task,
                pba.pba_year,
                pba.pba_month,
                CASE 
                    WHEN pbd.docname IS NULL OR pbd.docname = '' THEN 'without_task'
                    ELSE 'with_task'
                END as data_type,
                SUM(COALESCE(pba.pba_plan, 0)) as plan,
                SUM(COALESCE(pba.pba_expected, 0)) as forecast
            FROM `tabProject Budget Amount` pba
            INNER JOIN `tabProject Budget` pb ON pba.parent = pb.name
            LEFT JOIN `tabProject Budget Dimension` pbd ON pbd.parent = pb.name 
                AND pbd.doc = 'Task'
            LEFT JOIN `tabProject` p ON pb.pb_project = p.name
            WHERE pba.pba_year BETWEEN %(from_year)s AND %(to_year)s
                AND {where_clause}
            GROUP BY pb.pb_account, pb.pb_project, pbd.docname, pba.pba_year, pba.pba_month
            ORDER BY pb.pb_account, pba.pba_year, pba.pba_month
        """.format(where_clause=where_clause)
        
        raw_budget_data = frappe.db.sql(sql_query, filter_values, as_dict=1)
        
        frappe.log(f"Raw budget data for project {project}: {len(raw_budget_data)} rows")
        
        # Логируем детали для отладки
        if raw_budget_data:
            frappe.log(f"Sample data for project {project}:")
            for i, row in enumerate(raw_budget_data[:5]):
                frappe.log(f"  Row {i+1}: Account='{row.get('pb_account', 'Unknown')}', "
                          f"Month={int(row.get('pba_year', 0))}-{int(row.get('pba_month', 0)):02d}, "
                          f"plan={row.get('plan', 0)}, forecast={row.get('forecast', 0)}")
        else:
            frappe.log(f"No budget data found for project {project} in period {from_month}-{to_month}")
            
            # Проверим более детально
            check_query = """
                SELECT 
                    pba.pba_year,
                    pba.pba_month,
                    COUNT(*) as cnt 
                FROM `tabProject Budget Amount` pba
                INNER JOIN `tabProject Budget` pb ON pba.parent = pb.name
                WHERE pb.pb_project = %s
                    AND pba.pba_year = %s
                GROUP BY pba.pba_year, pba.pba_month
                ORDER BY pba.pba_year, pba.pba_month
            """
            check_result = frappe.db.sql(check_query, (project, filters.get("from_year")), as_dict=1)
            frappe.log(f"Budget records by month for project {project}:")
            for record in check_result:
                frappe.log(f"  {record.get('pba_year')}-{record.get('pba_month')}: {record.get('cnt')} records")
        
        frappe.log(f"=== GET RAW BUDGET DATA FOR PROJECT {project} END ===")
        
        return raw_budget_data
        
    except Exception as e:
        frappe.log(f"Error in get_raw_budget_data_for_project for project {project}: {str(e)}")
        frappe.log_error(f"Error in get_raw_budget_data_for_project: {traceback.format_exc()}")
        return []

def process_project_data(project, filters):
    """
    Обрабатывает данные для одного проекта
    Возвращает данные по статьям для этого проекта с флагом has_own_data
    """
    frappe.log(f"=== PROCESS PROJECT DATA APPLY CC ALLOCATION VALUE: {filters.get('apply_cc_allocation', 'NOT FOUND')} ===")
    
    from_month = cint(filters.get("from_month", 1))
    to_month = cint(filters.get("to_month", 12))
    frappe.log(f"Processing project {project} for period {from_month}-{to_month}")
    
    # 1. Получаем сырые данные для проекта
    raw_budget_data = get_raw_budget_data_for_project(project, filters)
    
    if not raw_budget_data:
        frappe.log(f"No budget data for project {project}")
        return []
    
    # 2. Получаем иерархию Task для этого проекта
    task_hierarchy = get_task_hierarchy(project)
    
    # 3. Группируем данные по счетам и периодам
    account_period_data = defaultdict(lambda: {
        'without_task': {'plan': 0, 'forecast': 0, 'rows': []},
        'with_task': {'plan': 0, 'forecast': 0, 'rows': []}
    })
    
    for row in raw_budget_data:
        account = row.get('pb_account', '')
        year = int(row.get('pba_year', 0))
        month = int(row.get('pba_month', 0))
        data_type = row.get('data_type', 'without_task')
        plan_amount = flt(row.get('plan', 0))
        forecast_amount = flt(row.get('forecast', 0))
        
        if year == 0 or month == 0 or not account:
            continue
        
        period_key = f"{year}_{month:02d}"
        
        if data_type == 'without_task':
            account_period_data[(account, period_key)]['without_task']['plan'] += plan_amount
            account_period_data[(account, period_key)]['without_task']['forecast'] += forecast_amount
            account_period_data[(account, period_key)]['without_task']['rows'].append(row)
        else:  # with_task
            account_period_data[(account, period_key)]['with_task']['plan'] += plan_amount
            account_period_data[(account, period_key)]['with_task']['forecast'] += forecast_amount
            account_period_data[(account, period_key)]['with_task']['rows'].append(row)
    
    # 4. Получаем фильтры для распределения
    cost_center_filter = filters.get("cost_center")
    business_area_filter = filters.get("business_area")
    
    # 5. Обрабатываем каждый счет и период
    project_result = []
    
    for (account, period_key), data_types in account_period_data.items():
        year, month = map(int, period_key.split('_'))
        
        without_task_data = data_types.get('without_task', {'plan': 0, 'forecast': 0, 'rows': []})
        with_task_data = data_types.get('with_task', {'plan': 0, 'forecast': 0, 'rows': []})
        
        # Правила Task:
        # 1. Если есть данные без Task → используем их (перекрывают данные с Task)
        # 2. Если нет данных без Task → используем данные с Task
        
        # Определяем, есть ли прямые данные (без Task)
        has_direct_data = (without_task_data['plan'] != 0 or without_task_data['forecast'] != 0)
        
        # Для ПЛАНА
        if without_task_data['plan'] != 0:
            # Используем данные без Task для плана
            final_plan = without_task_data['plan']
        else:
            # Используем данные с Task для плана
            if with_task_data['rows']:
                # Агрегируем план по Task с учетом иерархии
                final_plan = aggregate_tasks_for_account_and_period(
                    with_task_data['rows'], 
                    task_hierarchy, 
                    period_key, 
                    'plan'
                )
            else:
                final_plan = 0
        
        # Для ПРОГНОЗА
        if without_task_data['forecast'] != 0:
            # Используем данные без Task для прогноза
            final_forecast = without_task_data['forecast']
        else:
            # Используем данные с Task для прогноза
            if with_task_data['rows']:
                # Агрегируем прогноз по Task с учетом иерархии
                final_forecast = aggregate_tasks_for_account_and_period(
                    with_task_data['rows'], 
                    task_hierarchy, 
                    period_key, 
                    'forecast'
                )
            else:
                final_forecast = 0
        
        # Применяем распределение по CC/BA если есть фильтры
        if cost_center_filter or business_area_filter:
            if without_task_data['plan'] != 0 or without_task_data['forecast'] != 0:
                # Данные без Task - применяем распределение к итоговым суммам
                allocated_plan = calculate_allocation_for_month(
                    project=project,
                    year=year,
                    month=month,
                    total_amount=final_plan,
                    cost_center_filter=cost_center_filter,
                    business_area_filter=business_area_filter,
                    apply_allocation=filters.get("apply_cc_allocation", 0)
                ) if final_plan != 0 else 0
                
                allocated_forecast = calculate_allocation_for_month(
                    project=project,
                    year=year,
                    month=month,
                    total_amount=final_forecast,
                    cost_center_filter=cost_center_filter,
                    business_area_filter=business_area_filter,
                    apply_allocation=filters.get("apply_cc_allocation", 0)
                ) if final_forecast != 0 else 0
                
                if allocated_plan != 0 or allocated_forecast != 0:
                    project_result.append({
                        'account': account,
                        'year': year,
                        'month': month,
                        'plan': allocated_plan,
                        'forecast': allocated_forecast,
                        'has_own_data': has_direct_data  # Флаг: есть ли прямые данные (без Task)
                    })
            else:
                # Данные с Task - распределяем каждую Task отдельно
                total_plan = 0
                total_forecast = 0
                
                for task_row in with_task_data['rows']:
                    task_plan = flt(task_row.get('plan', 0))
                    task_forecast = flt(task_row.get('forecast', 0))
                    
                    if task_plan != 0:
                        allocated_plan = calculate_allocation_for_month(
                            project=project,
                            year=year,
                            month=month,
                            total_amount=task_plan,
                            cost_center_filter=cost_center_filter,
                            business_area_filter=business_area_filter,
                            apply_allocation=filters.get("apply_cc_allocation", 0)
                        )
                        total_plan += allocated_plan
                    
                    if task_forecast != 0:
                        allocated_forecast = calculate_allocation_for_month(
                            project=project,
                            year=year,
                            month=month,
                            total_amount=task_forecast,
                            cost_center_filter=cost_center_filter,
                            business_area_filter=business_area_filter,
                            apply_allocation=filters.get("apply_cc_allocation", 0)
                        )
                        total_forecast += allocated_forecast
                
                if total_plan != 0 or total_forecast != 0:
                    project_result.append({
                        'account': account,
                        'year': year,
                        'month': month,
                        'plan': total_plan,
                        'forecast': total_forecast,
                        'has_own_data': has_direct_data  # Флаг: есть ли прямые данные (без Task)
                    })
        else:
            # Без фильтров CC/BA - используем итоговые суммы
            if final_plan != 0 or final_forecast != 0:
                project_result.append({
                    'account': account,
                    'year': year,
                    'month': month,
                    'plan': final_plan,
                    'forecast': final_forecast,
                    'has_own_data': has_direct_data  # Флаг: есть ли прямые данные (без Task)
                })
    
    frappe.log(f"Project {project} processed: {len(project_result)} rows")
    
    # Логируем для отладки - ИСПРАВЛЕНО!
    for row in project_result:
        if row.get('has_own_data'):
            frappe.log(f"  {row['account']} {row['year']}-{row['month']:02d}: plan={row['plan']}, forecast={row['forecast']} (DIRECT DATA)")
        else:
            frappe.log(f"  {row['account']} {row['year']}-{row['month']:02d}: plan={row['plan']}, forecast={row['forecast']} (AGGREGATED FROM TASKS)")
    
    frappe.log(f"=== PROCESSING PROJECT {project} END ===")
    
    return project_result
    
def build_hierarchy_for_project(project_data, accounts, parent_children_map):
    """
    Строит иерархию для одного проекта
    Возвращает словарь {account: {period_key: {'plan': value, 'forecast': value}}}
    """
    frappe.log(f"=== BUILD HIERARCHY FOR PROJECT START ===")
    
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
            frappe.log(f"  Added OWN data to {account}: {period_key} plan={row['plan']}, forecast={row['forecast']}")
    
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
    
    frappe.log(f"Account indents: {account_indent}")
    frappe.log(f"Starting aggregation from level {max_indent} to 0")
    
    # 4. Агрегируем снизу вверх
    for current_indent in range(max_indent, -1, -1):
        accounts_at_level = [acc.name for acc in accounts if account_indent.get(acc.name, 0) == current_indent]
        frappe.log(f"Processing level {current_indent}, accounts: {accounts_at_level}")
        
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
            
            frappe.log(f"  Account {account_name}, children: {children}")
            frappe.log(f"  Child periods: {all_child_periods}")
            
            for period_key in all_child_periods:
                # Проверяем, есть ли у родителя СВОИ данные за этот период
                if account_info['has_own_data'].get(period_key, False):
                    frappe.log(f"  {account_name} has OWN data for {period_key}, skipping child aggregation")
                    continue
                
                # Суммируем данные от детей
                total_plan = 0
                total_forecast = 0
                
                for child in children:
                    if child in project_hierarchy:
                        child_data = project_hierarchy[child]['data'].get(period_key, {'plan': 0, 'forecast': 0})
                        total_plan += child_data['plan']
                        total_forecast += child_data['forecast']
                
                if total_plan != 0 or total_forecast != 0:
                    account_info['data'][period_key]['plan'] = total_plan
                    account_info['data'][period_key]['forecast'] = total_forecast
                    frappe.log(f"  {account_name} aggregated from children for {period_key}: plan={total_plan}, forecast={total_forecast}")
    
    frappe.log(f"=== BUILD HIERARCHY FOR PROJECT END ===")
    return project_hierarchy
    
def aggregate_across_projects(projects_hierarchy, accounts):
    """
    Суммирует иерархические данные по всем проектам
    Возвращает данные в формате, готовом для отчета (словарь account -> {period: values})
    """
    frappe.log(f"=== AGGREGATE ACROSS PROJECTS START ===")
    frappe.log(f"Aggregating {len(projects_hierarchy)} projects")
    
    # Итоговая структура: account -> period -> {'plan': 0, 'forecast': 0}
    final_data = defaultdict(lambda: defaultdict(lambda: {'plan': 0, 'forecast': 0}))
    
    # Суммируем по всем проектам
    for project_name, project_hierarchy in projects_hierarchy.items():
        frappe.log(f"Processing project {project_name}")
        
        for account_name, account_info in project_hierarchy.items():
            for period_key, values in account_info['data'].items():
                final_data[account_name][period_key]['plan'] += values['plan']
                final_data[account_name][period_key]['forecast'] += values['forecast']
                
                if values['plan'] != 0 or values['forecast'] != 0:
                    frappe.log(f"  Added to {account_name} {period_key}: plan={values['plan']}, forecast={values['forecast']}")
    
    # Преобразуем в формат для combine_budget_and_actual_data
    # Но combine_budget_and_actual_data ожидает список словарей с полями account, year, month, plan, forecast
    budget_data_result = []
    
    for account_name, periods in final_data.items():
        for period_key, values in periods.items():
            if values['plan'] != 0 or values['forecast'] != 0:
                try:
                    year, month = map(int, period_key.split('_'))
                    budget_data_result.append({
                        'account': account_name,
                        'year': year,
                        'month': month,
                        'plan': values['plan'],
                        'forecast': values['forecast']
                    })
                except Exception as e:
                    frappe.log(f"Error parsing period_key {period_key}: {str(e)}")
    
    frappe.log(f"Aggregated into {len(budget_data_result)} budget rows")
    frappe.log(f"=== AGGREGATE ACROSS PROJECTS END ===")
    
    return budget_data_result

def get_budget_data(filters, accounts):
    """
    Получает данные по бюджету и прогнозу
    Обрабатывает каждый проект отдельно, строит иерархию для каждого проекта,
    затем суммирует результаты
    """
    try:
        frappe.log("=== GET BUDGET DATA START ===")
        frappe.log(f"Input filters: {filters}")
        
        # Определяем список проектов для обработки
        projects_to_process = []
        
        if filters.get("project"):
            projects_to_process = [filters.get("project")]
        else:
            project_filters = {}
            if filters.get("project_portfolio"):
                project_filters["custom_project_portfolio"] = filters.get("project_portfolio")
            
            projects_to_process = frappe.get_all("Project", 
                filters=project_filters,
                pluck="name"
            )
            
            frappe.log(f"Found {len(projects_to_process)} projects to process")
        
        if not projects_to_process:
            frappe.log("No projects to process")
            return []
        
        # Получаем иерархию счетов для построения структуры
        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)
        
        # Словарь для хранения иерархических данных по каждому проекту
        projects_hierarchy = {}
        
        # Обрабатываем каждый проект отдельно
        for project in projects_to_process:
            try:
                frappe.log(f"=== Processing project {project} ===")
                
                # Получаем сырые данные для проекта
                project_raw_data = process_project_data(project, filters)
                frappe.log(f"Project {project} raw data: {len(project_raw_data)} rows")
                
                if not project_raw_data:
                    frappe.log(f"No data for project {project}, skipping")
                    continue
                
                # Строим иерархию для этого проекта
                project_hierarchy = build_hierarchy_for_project(
                    project_raw_data, 
                    accounts, 
                    parent_children_map
                )
                
                # Сохраняем иерархические данные проекта
                projects_hierarchy[project] = project_hierarchy
                frappe.log(f"Project {project} hierarchy built successfully")
                
            except Exception as e:
                frappe.log(f"Error processing project {project}: {str(e)}")
                frappe.log_error(f"Error processing project {project}: {traceback.format_exc()}")
                continue
        
        if not projects_hierarchy:
            frappe.log("No projects with data found")
            return []
        
        # Агрегируем данные по всем проектам
        final_budget_data = aggregate_across_projects(projects_hierarchy, accounts)
        
        frappe.log(f"Final budget data: {len(final_budget_data)} rows")
        frappe.log("=== GET BUDGET DATA END ===")
        
        return final_budget_data
        
    except Exception as e:
        error_msg = f"Error in get_budget_data: {str(e)}"
        frappe.log(f"=== ERROR IN GET_BUDGET_DATA ===")
        frappe.log(error_msg)
        frappe.log_error(title="Error in get_budget_data", message=traceback.format_exc())
        frappe.log(f"=== END ERROR ===")
        return []

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
                        ROUND(SUM(gle.debit - gle.credit), 0)
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
    
    # Находим корневые узлы доходов и расходов
    root_income_nodes = []
    root_expense_nodes = []
    
    # Сначала находим всех родителей
    all_parents = set()
    for row in data:
        if row.get("parent_account"):
            all_parents.add(row["parent_account"])
    
    # Находим корневые узлы
    for row in data:
        if row.get("is_profit_row") or row.get("is_profitability_row"):
            continue
            
        parent = row.get("parent_account")
        if not parent or parent not in data_by_account:
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

def get_accounts(filters):
    """Получает иерархию счетов как в финансовых отчетах - ТОЛЬКО АКТИВНЫЕ СЧЕТА (disabled = 0)"""
    company = filters.get("company") or frappe.defaults.get_user_default("Company")
    
    frappe.log(f"=== GET ACCOUNTS START (company: {company}) ===")
    
    accounts = frappe.db.sql("""
        SELECT
            name,
            account_name,
            parent_account,
            is_group,
            root_type,
            lft,
            rgt
        FROM `tabAccount`
        WHERE company = %s
            AND disabled = 0
            AND root_type IN ('Income', 'Expense')
        ORDER BY lft
    """, company, as_dict=1)
    
    frappe.log(f"Found {len(accounts)} ACTIVE accounts (disabled = 0)")
    frappe.log("=== GET ACCOUNTS END ===")
    
    return accounts

def get_data(filters):
    try:
        frappe.log("=== GET DATA START ===")
        frappe.log(f"ALL FILTERS RECEIVED: {filters}")
        
        # Получаем иерархию счетов
        accounts = get_accounts(filters)
        accounts_by_name = {acc.name: acc for acc in accounts}
        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)
        
        # 1. План/прогноз - сложная обработка
        budget_data = get_budget_data(filters, accounts)
        frappe.log(f"Budget data rows: {len(budget_data)}")
        
        # 2. Факт - простой SQL запрос (ВЫЗЫВАЕМ ФУНКЦИЮ!)
        actual_data = get_actual_data_simple(filters)  # ← ЭТО ВАЖНО!
        frappe.log(f"Actual data rows: {len(actual_data) if actual_data else 0}")
        
        # 3. Объединяем в одну структуру
        combined_data = {}
        
        # Инициализируем все счета
        for account in accounts:
            combined_data[account.name] = {
                "account": account.name,
                "parent_account": account.parent_account,
                "is_group": account.is_group,
                "root_type": account.root_type,
                "has_value": False,
                "is_leaf": False,
                "is_aggregated": False,
                "has_own_data": False
            }
        
        # Добавляем план/прогноз
        for row in budget_data:
            account = row['account']
            period_key = "{0}_{1:02d}".format(int(row['year']), int(row['month']))
            
            if account in combined_data:
                combined_data[account][f"plan_{period_key}"] = flt(row['plan'])
                combined_data[account][f"forecast_{period_key}"] = flt(row['forecast'])
                
                if flt(row['plan']) != 0 or flt(row['forecast']) != 0:
                    combined_data[account]["has_value"] = True
                    combined_data[account]["has_own_data"] = True
        
        # Добавляем факт (только если есть данные)
        if actual_data:
            for row in actual_data:
                account = row['account']
                period_key = "{0}_{1:02d}".format(int(row['year']), int(row['month']))
                
                if account in combined_data:
                    combined_data[account][f"actual_{period_key}"] = flt(row['actual'])
                    
                    if flt(row['actual']) != 0:
                        combined_data[account]["has_value"] = True
                        combined_data[account]["has_own_data"] = True
        
        # 4. Строим иерархию
        data = []
        root_accounts = [acc for acc in accounts if not acc.parent_account]
        root_accounts.sort(key=lambda x: (x.root_type != 'Income', x.lft))
        
        for root_acc in root_accounts:
            add_account_hierarchy(root_acc, accounts, combined_data, data, 0)
        
        # 5. Аккумулируем ВСЕ типы данных вверх по иерархии
        data = accumulate_all_values_upwards(data, parent_children_map, filters)
        
        # 6. Применяем логику forecast_actual если нужно
        if filters.get("view_type") == "forecast_actual":
            data = apply_forecast_actual_logic(data, filters)
        
        # 7. Фильтруем нулевые строки
        if not filters.get("show_zero_rows"):
            data = filter_out_zero_value_rows(data, parent_children_map, show_zero_values=False)
        
        frappe.log(f"Final data rows: {len(data)}")
        frappe.log("=== GET DATA END ===")
        
        return data
    except Exception as e:
        frappe.log(f"Error in get_data: {str(e)}")
        frappe.log_error(f"Error in get_data: {traceback.format_exc()}")
        return []

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
        
        if filters.get("project"):
            conditions.append("gle.project = %(project)s")
            filter_values["project"] = filters.get("project")
        
        if filters.get("cost_center"):
            conditions.append("gle.cost_center = %(cost_center)s")
            filter_values["cost_center"] = filters.get("cost_center")
        
        if filters.get("business_area"):
            conditions.append("gle.business_area = %(business_area)s")
            filter_values["business_area"] = filters.get("business_area")
        
        if filters.get("project_portfolio") and not filters.get("project"):
            conditions.append("""
                EXISTS (
                    SELECT 1 FROM `tabProject` p 
                    WHERE p.name = gle.project 
                    AND p.custom_project_portfolio = %(project_portfolio)s
                )
            """)
            filter_values["project_portfolio"] = filters.get("project_portfolio")
        
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
                        ROUND(SUM(gle.debit - gle.credit), 0)
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
    
    # Фильтр по проекту
    if filters.get("project"):
        sales_query += " AND si.project = %(project)s"
        sales_params["project"] = filters.get("project")
    
    # Фильтр по cost_center
    if filters.get("cost_center"):
        sales_query += " AND sii.cost_center = %(cost_center)s"
        sales_params["cost_center"] = filters.get("cost_center")
    
    # Фильтр по business_area (если есть в Sales Invoice)
    if filters.get("business_area"):
        sales_query += " AND si.custom_business_area = %(business_area)s"
        sales_params["business_area"] = filters.get("business_area")
    
    # Фильтр по project_portfolio
    if filters.get("project_portfolio") and not filters.get("project"):
        sales_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p 
                WHERE p.name = si.project 
                AND p.custom_project_portfolio = %(project_portfolio)s
            )
        """
        sales_params["project_portfolio"] = filters.get("project_portfolio")
    
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
    
    # Фильтр по проекту
    if filters.get("project"):
        purchase_query += " AND pii.project = %(project)s"
        purchase_params["project"] = filters.get("project")
    
    # Фильтр по cost_center
    if filters.get("cost_center"):
        purchase_query += " AND pii.cost_center = %(cost_center)s"
        purchase_params["cost_center"] = filters.get("cost_center")
    
    # Фильтр по business_area (если есть в Purchase Invoice)
    if filters.get("business_area"):
        purchase_query += " AND pi.custom_business_area = %(business_area)s"
        purchase_params["business_area"] = filters.get("business_area")
    
    # Фильтр по project_portfolio
    if filters.get("project_portfolio") and not filters.get("project"):
        purchase_query += """
            AND EXISTS (
                SELECT 1 FROM `tabProject` p 
                WHERE p.name = pii.project 
                AND p.custom_project_portfolio = %(project_portfolio)s
            )
        """
        purchase_params["project_portfolio"] = filters.get("project_portfolio")
    
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

def accumulate_all_values_upwards(data, parent_children_map, filters):
    """
    Аккумулирует ВСЕ типы данных (plan, forecast, actual) вверх по иерархии
    Как в старой версии кода
    """
    frappe.log("=== ACCUMULATE ALL VALUES UPWARDS START ===")
    
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
                    
                    # Если у узла уже есть собственные данные, не перезаписываем их
                    if current_value != 0 and row.get("has_own_data"):
                        continue
                    
                    # Суммируем от детей
                    total_from_children = 0
                    for child in children:
                        child_name = child.name if hasattr(child, 'name') else child
                        child_row = data_by_account.get(child_name)
                        if child_row:
                            total_from_children += flt(child_row.get(key, 0))
                    
                    # Обновляем значение
                    if total_from_children != 0:
                        row[key] = total_from_children
                        row["has_value"] = True
                        
                        if not row.get("has_own_data"):
                            row["is_aggregated"] = True
    
    frappe.log("=== ACCUMULATE ALL VALUES UPWARDS END ===")
    return data

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
                        "amount_type": "Plan" if data_type == 'plan' else "Exp."
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