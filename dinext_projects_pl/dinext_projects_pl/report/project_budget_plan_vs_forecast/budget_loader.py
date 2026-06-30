# Copyright (c) 2025, Dinord and contributors
import frappe
import traceback
from frappe.utils import flt, cint
from collections import defaultdict

from .allocation import calculate_allocation_for_month
from .allocation_cache import prefetch_allocation_histories
from .filter_utils import (
	SQL_EXCLUDE_PROJECT_RISK_BUDGET,
	get_company_names,
	risk_budget_sql_params,
)
from .hierarchy import build_hierarchy_for_project

def get_task_hierarchies(projects):
    """Загружает иерархии Task для нескольких проектов одним запросом."""
    if not projects:
        return {}

    tasks = frappe.get_all(
        "Task",
        filters={"project": ["in", list(projects)]},
        fields=["name", "subject", "parent_task", "project", "lft", "rgt"],
        order_by="lft",
    )

    by_project = defaultdict(dict)
    for task in tasks:
        by_project[task.project][task.name] = {
            "name": task.name,
            "subject": task.subject,
            "parent_task": task.parent_task,
            "children": [],
        }

    for task in tasks:
        parent = task.parent_task
        if parent and parent in by_project[task.project]:
            by_project[task.project][parent]["children"].append(
                by_project[task.project][task.name]
            )

    return dict(by_project)


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

def _build_raw_budget_query(filters, *, project=None, projects=None):
    final_conditions = []
    filter_values = {
        "from_year": filters.get("from_year"),
        "to_year": filters.get("to_year"),
        **risk_budget_sql_params(),
    }

    from_month = cint(filters.get("from_month"))
    to_month = cint(filters.get("to_month"))

    if from_month:
        final_conditions.append("pba.pba_month >= %(from_month)s")
        filter_values["from_month"] = from_month

    if to_month:
        final_conditions.append("pba.pba_month <= %(to_month)s")
        filter_values["to_month"] = to_month

    if projects is not None:
        final_conditions.append("pb.pb_project IN %(projects)s")
        filter_values["projects"] = tuple(projects)
    elif project:
        final_conditions.append("pb.pb_project = %(project)s")
        filter_values["project"] = project

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
            {risk_exclude}
        GROUP BY pb.pb_account, pb.pb_project, pbd.docname, pba.pba_year, pba.pba_month
        ORDER BY pb.pb_project, pb.pb_account, pba.pba_year, pba.pba_month
    """.format(where_clause=where_clause, risk_exclude=SQL_EXCLUDE_PROJECT_RISK_BUDGET)

    return sql_query, filter_values


def get_raw_budget_data_for_projects(projects, filters):
    """Batch-загрузка бюджетных данных для списка проектов."""
    if not projects:
        return []

    try:
        sql_query, filter_values = _build_raw_budget_query(filters, projects=projects)
        return frappe.db.sql(sql_query, filter_values, as_dict=1)
    except Exception as e:
        frappe.log_error(
            title="Error in get_raw_budget_data_for_projects",
            message=traceback.format_exc(),
        )
        frappe.log(f"Error in get_raw_budget_data_for_projects: {str(e)}")
        return []


def get_raw_budget_data_for_project(project, filters):
    """
    Получает сырые бюджетные данные для конкретного проекта с РАЗДЕЛЕНИЕМ по Task
    """
    try:
        sql_query, filter_values = _build_raw_budget_query(filters, project=project)
        return frappe.db.sql(sql_query, filter_values, as_dict=1)

    except Exception as e:
        frappe.log(f"Error in get_raw_budget_data_for_project for project {project}: {str(e)}")
        frappe.log_error(f"Error in get_raw_budget_data_for_project: {traceback.format_exc()}")
        return []

def process_project_data(project, filters, raw_budget_data=None, task_hierarchy=None):
    """
    Обрабатывает данные для одного проекта
    Возвращает данные по статьям для этого проекта с флагом has_own_data
    """
    from_month = cint(filters.get("from_month", 1))
    to_month = cint(filters.get("to_month", 12))

    if raw_budget_data is None:
        raw_budget_data = get_raw_budget_data_for_project(project, filters)

    if not raw_budget_data:
        return []

    if task_hierarchy is None:
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
        
        # Writable projects only (see permissions.apply_report_project_permissions).
        projects_to_process = filters.get("_report_writable_projects")
        if projects_to_process is None:
            from .permissions import get_writable_report_projects

            projects_to_process = get_writable_report_projects(filters)
            filters["_report_writable_projects"] = projects_to_process

        if not projects_to_process:
            return []

        needs_allocation = filters.get("cost_center") or filters.get("business_area")
        if needs_allocation:
            prefetch_allocation_histories(projects_to_process)

        parent_children_map = defaultdict(list)
        for acc in accounts:
            parent_children_map[acc.parent_account or None].append(acc)

        projects_hierarchy = {}
        raw_by_project = defaultdict(list)
        for row in get_raw_budget_data_for_projects(projects_to_process, filters):
            raw_by_project[row.get("project")].append(row)

        task_hierarchies = get_task_hierarchies(projects_to_process)

        for project in projects_to_process:
            try:
                project_raw_data = process_project_data(
                    project,
                    filters,
                    raw_budget_data=raw_by_project.get(project, []),
                    task_hierarchy=task_hierarchies.get(project, {}),
                )

                if not project_raw_data:
                    continue

                project_hierarchy = build_hierarchy_for_project(
                    project_raw_data,
                    accounts,
                    parent_children_map,
                )
                projects_hierarchy[project] = project_hierarchy

            except Exception as e:
                frappe.log_error(
                    title=f"Error processing project {project}",
                    message=traceback.format_exc(),
                )
                frappe.log(f"Error processing project {project}: {str(e)}")
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

def get_accounts(filters):
    """Получает иерархию счетов как в финансовых отчетах - ТОЛЬКО АКТИВНЫЕ СЧЕТА (disabled = 0)"""
    companies = get_company_names(filters)
    if not companies:
        return []

    frappe.log(f"=== GET ACCOUNTS START (companies: {companies}) ===")

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
        WHERE company IN %(companies)s
            AND disabled = 0
            AND root_type IN ('Income', 'Expense')
        ORDER BY lft
    """, {"companies": tuple(companies)}, as_dict=1)
    
    frappe.log(f"Found {len(accounts)} ACTIVE accounts (disabled = 0)")
    frappe.log("=== GET ACCOUNTS END ===")
    
    return accounts
