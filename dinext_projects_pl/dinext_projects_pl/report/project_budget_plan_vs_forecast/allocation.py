# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from frappe.utils import flt, today, getdate, add_days, get_last_day, date_diff

def normalize_match_values(value):
    """Return a set of selected filter values for scalar or multi-select filters."""
    if not value:
        return set()
    if isinstance(value, (list, tuple, set)):
        return {item for item in value if item}
    return {value}

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
        cost_center_values = normalize_match_values(cost_center_filter)
        business_area_values = normalize_match_values(business_area_filter)
        
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
            
            if cost_center_values:
                if apply_allocation:
                    # Проверяем, есть ли у period_cc аллокация
                    allocation = get_cost_center_allocation(period_cc, period.get('start_date'))
                    
                    if allocation:
                        # У родительского CC есть аллокация
                        frappe.log(f"    -> CC '{period_cc}' has allocation {allocation['name']} with {len(allocation['children'])} children")
                        
                        # Ищем дочерний CC, совпадающий с фильтром
                        matched = False
                        for child in allocation['children']:
                            if child['cost_center'] in cost_center_values:
                                amount_after_cc = period_amount * (child['percentage'] / 100)
                                frappe.log(f"    -> CHILD MATCH! Child CC '{child['cost_center']}' ({child['percentage']}%) = {amount_after_cc:.2f}")
                                matched = True
                                break
                        
                        if not matched:
                            frappe.log(f"    -> NO CHILD MATCH: Filter CC '{cost_center_filter}' not found in allocation children")
                    else:
                        # Нет аллокации - прямое сравнение
                        if period_cc and period_cc in cost_center_values:
                            amount_after_cc = period_amount
                            frappe.log(f"    -> CC MATCH (no allocation)! Period CC '{period_cc}' == Filter CC '{cost_center_filter}'")
                        elif period_cc:
                            frappe.log(f"    -> CC MISMATCH: Period CC '{period_cc}' != Filter CC '{cost_center_filter}'")
                        else:
                            frappe.log(f"    -> No CC in this period")
                else:
                    # Аллокация выключена - прямое сравнение
                    if period_cc and period_cc in cost_center_values:
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
            if business_area_values and amount_after_cc != 0:
                matched_ba = False
                for ba in business_areas:
                    ba_name = ba.get('business_area')
                    ba_percent = flt(ba.get('percent', 0))
                    if ba_name and ba_name in business_area_values and ba_percent > 0:
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
