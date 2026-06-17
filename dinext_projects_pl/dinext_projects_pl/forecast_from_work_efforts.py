# Copyright (c) 2026, Dinext
"""Add P&L forecast from project work efforts and workload (ISS-2025-03107)."""

import json

import frappe


def _dimensions_key(dimensions):
    if not dimensions:
        return ""
    parts = sorted(f"{d.get('doc')}:{d.get('docname')}" for d in dimensions if d.get("doc"))
    return "|".join(parts)


def _find_project_budget(project, account, dimensions):
    budgets = frappe.get_all(
        "Project Budget",
        filters={"pb_project": project, "pb_account": account},
        fields=["name"],
    )
    target_key = _dimensions_key(dimensions)
    for b in budgets:
        doc = frappe.get_cached_doc("Project Budget", b.name)
        dims = doc.get("project_budget_dimension") or []
        doc_dims = [{"doc": d.get("doc"), "docname": d.get("docname")} for d in dims]
        if _dimensions_key(doc_dims) == target_key:
            return doc.name
    return None


def _set_forecast_in_budget(project, account, dimensions, period_amount_map):
    """Перезаписывает forecast в Project Budget. period_amount_map: {(year, month): amount}."""
    if not period_amount_map:
        return None

    existing = _find_project_budget(project, account, dimensions)
    if existing:
        doc = frappe.get_doc("Project Budget", existing)
    else:
        frappe.has_permission("Project Budget", "create", throw=True)
        doc = frappe.new_doc("Project Budget")
        doc.pb_project = project
        doc.pb_account = account
        for d in dimensions:
            doc.append("project_budget_dimension", {"doc": d["doc"], "docname": d["docname"]})

    new_amounts = {}
    for row in doc.get("project_budget_amount") or []:
        if row.pba_year is not None:
            new_amounts[(row.pba_year, row.pba_month)] = float(row.pba_expected or 0)

    for key, value in period_amount_map.items():
        new_amounts[key] = float(value)

    doc.project_budget_amount = []
    for (fy, month), value in sorted(new_amounts.items(), key=lambda x: (x[0][0], x[0][1])):
        doc.append("project_budget_amount", {
            "pba_year": fy,
            "pba_month": month,
            "pba_expected": value
        })

    doc.save()
    return doc.name


ENABLE_DETAILED_LOG = True


def _debug_log(message):
    if ENABLE_DETAILED_LOG:
        frappe.log(message)


def _parse_confirm_recalc(value):
    return value in (True, 1, "1", "true", "True")


def _parse_inputs(fd):
    project = fd.get("project")
    selected_tasks = fd.get("tasks") or []
    if isinstance(selected_tasks, str):
        selected_tasks = json.loads(selected_tasks) if selected_tasks else []
    forecast_details = fd.get("forecast_details") or {}
    if isinstance(forecast_details, str):
        forecast_details = json.loads(forecast_details) if forecast_details else {}
    confirm_recalc = _parse_confirm_recalc(fd.get("confirm_recalc", False))
    forecast_type = fd.get("forecast_type", "cost")
    income_account = fd.get("income_account") or None
    return project, selected_tasks, forecast_details, confirm_recalc, forecast_type, income_account


def _process_single_forecast_type(project, selected_tasks, forecast_details, confirm_recalc,
                                   forecast_type, income_account):
    """Обрабатывает один тип прогноза: 'cost' или 'revenue'."""
    _debug_log(f"STEP 2: Getting project data (forecast_type={forecast_type})")

    # ========== 1. ПОЛУЧАЕМ ДАННЫЕ ПРОЕКТА ==========
    Project = frappe.qb.DocType('Project')
    project_query = (
        frappe.qb.from_(Project)
        .select(Project.custom_payment_scheme)
        .where(Project.name == project)
        .limit(1)
    )
    project_result = project_query.run(as_dict=True)
    payment_scheme = project_result[0].get('custom_payment_scheme') if project_result else None
    _debug_log(f"  payment_scheme: {payment_scheme}")

    # ========== 2. ПОЛУЧАЕМ СТАТЬИ БЮДЖЕТА (только для cost) ==========
    account_table = []
    if forecast_type == "cost":
        _debug_log("STEP 2.1: Getting account table from project")

        AccountTable = frappe.qb.DocType('Account Table')
        account_query = (
            frappe.qb.from_(AccountTable)
            .select(
                AccountTable.ac_valid_from,
                AccountTable.ac_type,
                AccountTable.ac_account
            )
            .where(AccountTable.parent == project)
        )
        account_table = account_query.run(as_dict=True)
        account_table.sort(key=lambda x: x.get('ac_valid_from') if x.get('ac_valid_from') else frappe.utils.getdate("1900-01-01"))
        _debug_log(f"  account_table found: {len(account_table)}")

    # ========== 3. ПОЛУЧАЕМ PROJECT TEAM DETAILS ==========
    _debug_log("STEP 3: Getting team details")

    ProjectTeamDetails = frappe.qb.DocType('Project Team Details')
    team_query = (
        frappe.qb.from_(ProjectTeamDetails)
        .select(
            ProjectTeamDetails.pt_role,
            ProjectTeamDetails.pt_participant,
            ProjectTeamDetails.pt_cost_level,
            ProjectTeamDetails.pt_category
        )
        .where(ProjectTeamDetails.parent == project)
        .where(ProjectTeamDetails.virtual_worker == 0)
    )
    team_details = team_query.run(as_dict=True)

    team_details_map = {}
    for td in team_details:
        key = (td.get('pt_role'), td.get('pt_participant'))
        team_details_map[key] = td

    _debug_log(f"  team_details found: {len(team_details)}")

    # ========== 3.1. ПОЛУЧАЕМ ВИРТУАЛЬНЫХ УЧАСТНИКОВ ==========
    _debug_log("STEP 3.1: Getting virtual team details")

    virtual_query = (
        frappe.qb.from_(ProjectTeamDetails)
        .select(
            ProjectTeamDetails.pt_role,
            ProjectTeamDetails.pt_cost_level,
            ProjectTeamDetails.pt_category,
            ProjectTeamDetails.virtual_worker,
            ProjectTeamDetails.worker_type
        )
        .where(ProjectTeamDetails.parent == project)
        .where(ProjectTeamDetails.virtual_worker == 1)
    )
    virtual_team_details = virtual_query.run(as_dict=True)

    virtual_team_map = {}
    for vtd in virtual_team_details:
        virtual_team_map[vtd.get('pt_role')] = vtd
        _debug_log(f"  Virtual worker for role {vtd.get('pt_role')}: cost_level={vtd.get('pt_cost_level')}, category={vtd.get('pt_category')}")

    # ========== 4. ОПРЕДЕЛЯЕМ ТИП ПОЛЬЗОВАТЕЛЯ (только для cost) ==========
    user_type_cache = {}
    if forecast_type == "cost":
        _debug_log("STEP 4: Getting worker types")

        Worker = frappe.qb.DocType('Worker')

        for td in team_details:
            user = td.get('pt_participant')
            if user and user not in user_type_cache:
                worker_query = (
                    frappe.qb.from_(Worker)
                    .select(Worker.wtype)
                    .where(Worker.wuser == user)
                    .limit(1)
                )
                worker_result = worker_query.run(as_dict=True)

                if worker_result and worker_result[0].get('wtype'):
                    user_type_cache[user] = worker_result[0].get('wtype')
                    _debug_log(f"  User {user} -> {user_type_cache[user]}")
                else:
                    _debug_log(f"  WARNING: User {user} has no Worker type, will be skipped")
                    user_type_cache[user] = None

    # ========== 4.1. ПОЛУЧАЕМ COST LEVELS ИЗ WORKER LEVEL (только для cost) ==========
    cost_levels_cache = {}
    if forecast_type == "cost":
        _debug_log("STEP 4.1: Getting cost levels from Worker Level")

        Worker = frappe.qb.DocType('Worker')
        WorkerLevel = frappe.qb.DocType('Worker Level')

        for td in team_details:
            user = td.get('pt_participant')
            if user and user not in cost_levels_cache:
                worker_query = (
                    frappe.qb.from_(Worker)
                    .select(Worker.name)
                    .where(Worker.wuser == user)
                    .limit(1)
                )
                worker_result = worker_query.run(as_dict=True)

                if worker_result:
                    worker_name = worker_result[0].get('name')
                    wl_query = (
                        frappe.qb.from_(WorkerLevel)
                        .select(
                            WorkerLevel.wl_valid_from,
                            WorkerLevel.wl_cosl_level.as_('cost_level')
                        )
                        .where(WorkerLevel.parent == worker_name)
                        .orderby(WorkerLevel.wl_valid_from)
                    )
                    worker_levels = wl_query.run(as_dict=True)

                    cost_levels_cache[user] = []
                    for wl in worker_levels:
                        cost_levels_cache[user].append({
                            'valid_from': wl.get('wl_valid_from'),
                            'cost_level': wl.get('cost_level')
                        })
                    _debug_log(f"  User {user} cost levels: {len(cost_levels_cache[user])}")
                else:
                    cost_levels_cache[user] = []
                    _debug_log(f"  User {user} has no Worker record")

    # ========== 5. ОПРЕДЕЛЯЕМ ИСТОЧНИК СТАВКИ ==========
    if forecast_type == "revenue":
        rate_source_field = "pt_category"
        rate_parenttype = "Rate Category"
    else:
        rate_source_field = "pt_cost_level"
        rate_parenttype = "Cost Level"

    _debug_log(f"  rate_source_field: {rate_source_field}, parenttype: {rate_parenttype}")

    # ========== 6. ЗАГРУЖАЕМ СТАВКИ ==========
    parent_values = set()
    for td in team_details:
        if rate_source_field == "pt_category":
            value = td.get("pt_category")
            if value:
                parent_values.add(value)
        else:
            value = td.get("pt_cost_level")
            if not value:
                user = td.get('pt_participant')
                user_cost_levels = cost_levels_cache.get(user, [])
                for cl in user_cost_levels:
                    if cl.get('cost_level'):
                        parent_values.add(cl.get('cost_level'))
            else:
                parent_values.add(value)

    # Для revenue также добавляем pt_category виртуальных участников
    if forecast_type == "revenue":
        for vtd in virtual_team_details:
            value = vtd.get("pt_category")
            if value:
                parent_values.add(value)

    _debug_log(f"  parent_values: {parent_values}")

    rates = {}
    if parent_values:
        _debug_log("STEP 6: Loading rate records")
        RateTable = frappe.qb.DocType('Rate Table')
        rate_query = (
            frappe.qb.from_(RateTable)
            .select(
                RateTable.parent,
                RateTable.rt_valid_from,
                RateTable.rt_rate,
                RateTable.rt_currency
            )
            .where(RateTable.parenttype == rate_parenttype)
            .where(RateTable.parent.isin(list(parent_values)))
        )
        rate_records = rate_query.run(as_dict=True)

        _debug_log(f"  rate_records found: {len(rate_records)}")

        for rate in rate_records:
            parent = rate.get('parent')
            if parent not in rates:
                rates[parent] = []
            rates[parent].append({
                'valid_from': rate.get('rt_valid_from'),
                'rate': float(rate.get('rt_rate') or 0),
                'currency': rate.get('rt_currency')
            })

        for parent in rates:
            rates[parent].sort(key=lambda x: x['valid_from'] if x['valid_from'] else frappe.utils.getdate("1900-01-01"))

        _debug_log(f"  rates loaded for parents: {list(rates.keys())}")

    # ========== 7. ПОЛУЧАЕМ ИНФОРМАЦИЮ ОБ ИЗМЕРЕНИЯХ ==========
    _debug_log("STEP 7: Getting accounting dimension filters for Task")

    AccountingDimensionFilter = frappe.qb.DocType('Accounting Dimension Filter')
    ApplicableOnAccount = frappe.qb.DocType('Applicable On Account')

    dim_query = (
        frappe.qb.from_(AccountingDimensionFilter)
        .left_join(ApplicableOnAccount)
        .on(ApplicableOnAccount.parent == AccountingDimensionFilter.name)
        .select(
            AccountingDimensionFilter.name,
            ApplicableOnAccount.applicable_on_account.as_('account')
        )
        .where(AccountingDimensionFilter.accounting_dimension == 'Task')
        .where(AccountingDimensionFilter.disabled == 0)
    )
    task_dimension_filters = dim_query.run(as_dict=True)

    accounts_with_task_dimension = set()
    for row in task_dimension_filters:
        if row.get('account'):
            accounts_with_task_dimension.add(row.get('account'))

    _debug_log(f"  Accounts supporting Task dimension: {accounts_with_task_dimension}")

    # Для revenue проверяем, поддерживает ли income_account измерение Task
    if forecast_type == "revenue":
        income_has_task_dimension = income_account in accounts_with_task_dimension

    # ========== 7.5. ФУНКЦИЯ ПЕРЕСЧЕТА ПРОГНОЗА ==========
    def recalculate_forecast_and_loads(forecast_hours, users_data):
        type3_users = []
        other_users = []

        for u in users_data:
            if u.get('workload_type') == 'В % от трудоемкости задачи':
                type3_users.append(u)
            else:
                other_users.append(u)

        total_type3_load = sum(u.get('original_hours', 0) for u in type3_users)
        total_other_load = sum(u.get('original_hours', 0) for u in other_users)

        if forecast_hours < total_type3_load:
            new_forecast = total_type3_load
        else:
            new_forecast = forecast_hours

        remaining_forecast = max(0, new_forecast - total_type3_load)

        new_loads = {}
        for u in type3_users:
            new_loads[u.get('user')] = u.get('original_hours', 0)

        if total_other_load > 0 and remaining_forecast > 0:
            for u in other_users:
                ratio = u.get('original_hours', 0) / total_other_load
                new_loads[u.get('user')] = remaining_forecast * ratio
        else:
            for u in other_users:
                new_loads[u.get('user')] = 0

        return new_forecast, new_loads

    # ========== 8. РАССЧИТЫВАЕМ СУММЫ И ЗАПИСЫВАЕМ В БЮДЖЕТ ==========
    _debug_log("STEP 8: Calculating amounts and saving to budget")

    results = []
    updated_count = 0
    should_stop = False

    for task in selected_tasks:
        _debug_log(f"STEP 8.1: Processing task: {task}")
        task_details = forecast_details.get(task, {})

        aggregated_by_account_for_task = {}

        for role, periods in task_details.items():
            _debug_log(f"  Role: {role}")

            # Находим пользователя с этой ролью
            matching_users = []
            for (td_role, td_user), td in team_details_map.items():
                if td_role == role:
                    if forecast_type == "cost":
                        user_type = user_type_cache.get(td_user)
                        if user_type:
                            matching_users.append((td_user, td))
                        else:
                            _debug_log(f"    Skipping user {td_user} - no valid worker type")
                    else:
                        # Для revenue не фильтруем по worker type
                        matching_users.append((td_user, td))

            if not matching_users:
                _debug_log(f"    No valid users found for role {role}, skipping")
                continue

            for period_key, hours_data in periods.items():
                forecast_hours = hours_data.get('forecast_hours', 0)
                plan_hours = hours_data.get('plan_hours', 0)
                users_data = hours_data.get('users', {})

                _debug_log(f"    Period: {period_key}, forecast={forecast_hours}, plan={plan_hours}, users={len(users_data)}")

                if forecast_hours == 0:
                    continue

                if not period_key or '-' not in period_key:
                    _debug_log(f"      Invalid period_key format: {period_key}")
                    continue

                parts = period_key.split('-')
                if len(parts) != 2:
                    _debug_log(f"      Invalid period_key format: {period_key}")
                    continue

                if not parts[0].isdigit() or not parts[1].isdigit():
                    _debug_log(f"      Invalid year/month in period_key: {period_key}")
                    continue

                year = int(parts[0])
                month = int(parts[1])

                period_date = frappe.utils.getdate(f"{year}-{month:02d}-01")

                users_forecast_data = {}
                for user_email, user_info in users_data.items():
                    users_forecast_data[user_email] = user_info

                users_for_period = []

                for user, team_detail in matching_users:
                    # Определяем parent для ставки
                    if rate_source_field == "pt_category":
                        parent_value = team_detail.get("pt_category")
                    else:
                        parent_value = team_detail.get("pt_cost_level")
                        if not parent_value:
                            user_cost_levels = cost_levels_cache.get(user, [])
                            for cl in user_cost_levels:
                                valid_from = cl.get('valid_from')
                                if not valid_from or valid_from <= period_date:
                                    parent_value = cl.get('cost_level')
                                else:
                                    break
                            if parent_value:
                                _debug_log(f"      Using base_cost_level from Worker Level: {parent_value}")

                    if not parent_value:
                        _debug_log(f"      No rate source for user {user}")
                        continue

                    parent_rates = rates.get(parent_value, [])
                    if not parent_rates:
                        _debug_log(f"      No rates found for parent={parent_value}")
                        continue

                    applicable_rate = None
                    for rate_info in parent_rates:
                        valid_from = rate_info.get('valid_from')
                        if valid_from and valid_from <= period_date:
                            applicable_rate = rate_info
                        else:
                            break

                    if not applicable_rate:
                        applicable_rate = parent_rates[-1] if parent_rates else None

                    if not applicable_rate:
                        _debug_log(f"      No applicable rate for user {user}")
                        continue

                    # Определяем счёт и измерение
                    if forecast_type == "revenue":
                        applicable_account = income_account
                        has_task_dimension = income_has_task_dimension
                        user_type = None  # не используется
                    else:
                        user_type = user_type_cache.get(user, 'Employee')
                        applicable_account = None
                        for at in account_table:
                            valid_from = at.get('ac_valid_from')
                            if at.get('ac_type') == user_type:
                                if not valid_from or valid_from <= period_date:
                                    applicable_account = at.get('ac_account')
                                    _debug_log(f"      Found account: {applicable_account} (type={user_type})")
                                    break

                        if not applicable_account:
                            _debug_log(f"      No account found for user_type={user_type}")
                            continue

                        has_task_dimension = applicable_account in accounts_with_task_dimension

                    user_forecast_info = users_forecast_data.get(user, {})
                    workload_type = user_forecast_info.get('workload_type', 'В рабочих часах')
                    percentage = user_forecast_info.get('percentage', 0)
                    assigned = user_forecast_info.get('assigned_hours', 0)

                    if workload_type == 'В % от трудоемкости задачи':
                        original_hours = assigned
                        if not original_hours and plan_hours and percentage:
                            original_hours = plan_hours * percentage / 100
                    else:
                        original_hours = assigned

                    _debug_log(f"      User: {user}, type={workload_type}, hours={original_hours}, plan={plan_hours}")

                    users_for_period.append({
                        'user': user,
                        'workload_type': workload_type,
                        'percentage': percentage,
                        'original_hours': original_hours,
                        'rate': applicable_rate.get('rate'),
                        'currency': applicable_rate.get('currency'),
                        'user_type': user_type,
                        'applicable_account': applicable_account,
                        'has_task_dimension': has_task_dimension,
                        'team_detail': team_detail
                    })

                # Проверка перегрузки
                total_pwa_hours = sum(u.get('original_hours', 0) for u in users_for_period)

                if total_pwa_hours > forecast_hours + 1:
                    _debug_log(f"      *** OVERLOAD: PWA={total_pwa_hours} > PWE={forecast_hours} ***")

                    if not confirm_recalc:
                        type_label = "затрат" if forecast_type == "cost" else "выручки"
                        return {
                            'success': False,
                            'needs_confirmation': True,
                            'message': f'Обнаружена перегрузка: назначенная загрузка ({round(total_pwa_hours, 2)}ч) превышает прогнозные трудозатраты ({forecast_hours}ч) по задаче "{task}", роли "{role}", периоду {period_key}. Выполнить пересчет прогноза {type_label} на основании текущей загрузки?',
                            'task': task,
                            'role': role,
                            'period': period_key,
                            'forecast_hours': forecast_hours,
                            'total_pwa_hours': total_pwa_hours
                        }
                    else:
                        _debug_log(f"      User confirmed, recalculating...")
                        recalc_result = recalculate_forecast_and_loads(forecast_hours, users_for_period)
                        new_forecast = recalc_result[0]
                        new_loads = recalc_result[1]

                        for u in users_for_period:
                            user_email = u.get('user')
                            if user_email in new_loads:
                                u['original_hours'] = new_loads[user_email]
                                _debug_log(f"      Updated hours for {user_email}: {new_loads[user_email]}h")

                # Проверка недогрузки
                elif total_pwa_hours < forecast_hours - 1:
                    _debug_log(f"      *** UNDERLOAD: PWA={total_pwa_hours} < PWE={forecast_hours} ***")

                    virtual = virtual_team_map.get(role)

                    if not virtual:
                        _debug_log(f"      ERROR: No virtual worker for role {role}")
                        return {
                            'success': False,
                            'error': f'Для роли "{role}" не найден виртуальный участник в команде проекта. Невозможно распределить остаток прогнозных часов ({round(forecast_hours - total_pwa_hours, 2)}ч).'
                        }

                    if not confirm_recalc:
                        type_label = "затрат" if forecast_type == "cost" else "выручки"
                        return {
                            'success': False,
                            'needs_confirmation': True,
                            'message': f'Обнаружена недогрузка: прогнозные трудозатраты ({forecast_hours}ч) превышают назначенную загрузку ({round(total_pwa_hours, 2)}ч) по задаче "{task}", роли "{role}", периоду {period_key}. Будет использован виртуальный участник для покрытия остатка ({round(forecast_hours - total_pwa_hours, 2)}ч) при расчёте {type_label}. Продолжить?',
                            'task': task,
                            'role': role,
                            'period': period_key,
                            'forecast_hours': forecast_hours,
                            'total_pwa_hours': total_pwa_hours
                        }
                    else:
                        _debug_log(f"      User confirmed, adding virtual worker for role {role}")

                        virtual_hours = forecast_hours - total_pwa_hours

                        if rate_source_field == "pt_category":
                            parent_value = virtual.get("pt_category")
                        else:
                            parent_value = virtual.get("pt_cost_level")

                        if not parent_value:
                            _debug_log(f"      ERROR: No rate source for virtual worker role {role}")
                            return {
                                'success': False,
                                'error': f'Для виртуального участника роли "{role}" не заполнена ставка.'
                            }

                        parent_rates = rates.get(parent_value, [])
                        if not parent_rates:
                            _debug_log(f"      No rates found for parent={parent_value}")
                            continue

                        applicable_rate = None
                        for rate_info in parent_rates:
                            valid_from = rate_info.get('valid_from')
                            if valid_from and valid_from <= period_date:
                                applicable_rate = rate_info
                            else:
                                break

                        if not applicable_rate:
                            applicable_rate = parent_rates[-1] if parent_rates else None

                        if not applicable_rate:
                            _debug_log(f"      No applicable rate for virtual worker role {role}")
                            continue

                        if forecast_type == "revenue":
                            applicable_account = income_account
                            has_task_dimension = income_has_task_dimension
                            user_type = None
                        else:
                            user_type = virtual.get("worker_type")
                            _debug_log(f"      Virtual worker user_type: {user_type}")

                            applicable_account = None
                            for at in account_table:
                                valid_from = at.get('ac_valid_from')
                                if at.get('ac_type') == user_type:
                                    if not valid_from or valid_from <= period_date:
                                        applicable_account = at.get('ac_account')
                                        _debug_log(f"      Found account for virtual worker: {applicable_account} (type={user_type})")
                                        break

                            if not applicable_account:
                                _debug_log(f"      No account found for user_type={user_type}")
                                continue

                            has_task_dimension = applicable_account in accounts_with_task_dimension

                        users_for_period.append({
                            'user': f'VIRTUAL_{role}',
                            'workload_type': 'Виртуальный участник',
                            'percentage': 0,
                            'original_hours': virtual_hours,
                            'rate': applicable_rate.get('rate'),
                            'currency': applicable_rate.get('currency'),
                            'user_type': user_type,
                            'applicable_account': applicable_account,
                            'has_task_dimension': has_task_dimension,
                            'team_detail': virtual,
                            'is_virtual': True
                        })

                        _debug_log(f"      Added virtual worker for {role}: {virtual_hours}h at rate {applicable_rate.get('rate')} {applicable_rate.get('currency')}")

                # Агрегируем суммы по статьям
                for u in users_for_period:
                    amount = u.get('original_hours', 0) * u.get('rate', 0)
                    applicable_account = u.get('applicable_account')
                    has_task_dimension = u.get('has_task_dimension', False)

                    _debug_log(f"      User: {u.get('user')}, hours={u.get('original_hours')}, rate={u.get('rate')}, amount={amount}, account={applicable_account}")

                    # Для revenue: группируем по (account, year, month, task)
                    # Для cost: группируем по (account, year, month, has_task_dimension)
                    if forecast_type == "revenue" and has_task_dimension:
                        key = (applicable_account, year, month, task)
                    else:
                        key = (applicable_account, year, month, has_task_dimension)

                    if key not in aggregated_by_account_for_task:
                        aggregated_by_account_for_task[key] = {
                            'total_amount': 0,
                            'users': [],
                            'has_task_dimension': has_task_dimension,
                            'account': applicable_account,
                            'year': year,
                            'month': month,
                            'task_for_revenue': task if (forecast_type == "revenue" and has_task_dimension) else None
                        }
                    aggregated_by_account_for_task[key]['total_amount'] = aggregated_by_account_for_task[key]['total_amount'] + amount
                    if u.get('user') not in aggregated_by_account_for_task[key]['users']:
                        aggregated_by_account_for_task[key]['users'].append(u.get('user'))

            if should_stop:
                break

        if should_stop:
            break

        # Записываем агрегированные суммы в бюджет
        for key, acc_data in aggregated_by_account_for_task.items():
            total_amount = acc_data['total_amount']

            if total_amount == 0:
                _debug_log(f"      Skipping zero amount for account={acc_data['account']}, year={acc_data['year']}, month={acc_data['month']}")
                continue

            users_list = ', '.join(set(acc_data['users']))
            applicable_account = acc_data['account']
            year = acc_data['year']
            month = acc_data['month']
            has_task_dimension = acc_data['has_task_dimension']

            _debug_log(f"      Writing to budget: account={applicable_account}, year={year}, month={month}, total_amount={total_amount}, users=[{users_list}]")

            # Ищем существующий Project Budget
            ProjectBudget = frappe.qb.DocType('Project Budget')
            ProjectBudgetDimension = frappe.qb.DocType('Project Budget Dimension')

            if has_task_dimension:
                target_task = acc_data.get('task_for_revenue') or task
                pb_query = (
                    frappe.qb.from_(ProjectBudget)
                    .left_join(ProjectBudgetDimension)
                    .on(ProjectBudgetDimension.parent == ProjectBudget.name)
                    .select(ProjectBudget.name)
                    .where(ProjectBudget.pb_project == project)
                    .where(ProjectBudget.pb_account == applicable_account)
                    .where(ProjectBudgetDimension.doc == 'Task')
                    .where(ProjectBudgetDimension.docname == target_task)
                    .limit(1)
                )
                pb_result = pb_query.run(as_dict=True)
                pb_name = pb_result[0].get('name') if pb_result else None
            else:
                pb_query = (
                    frappe.qb.from_(ProjectBudget)
                    .select(ProjectBudget.name)
                    .where(ProjectBudget.pb_project == project)
                    .where(ProjectBudget.pb_account == applicable_account)
                    .limit(1)
                )
                pb_result = pb_query.run(as_dict=True)
                pb_name = pb_result[0].get('name') if pb_result else None

            if pb_name:
                doc = frappe.get_doc("Project Budget", pb_name)
                _debug_log(f"      Found existing Project Budget: {pb_name}")

                if has_task_dimension:
                    target_task = acc_data.get('task_for_revenue') or task
                    task_dimension_exists = False
                    for dim in doc.project_budget_dimension:
                        if dim.doc == "Task" and dim.docname == target_task:
                            task_dimension_exists = True
                            break

                    if not task_dimension_exists:
                        doc.append("project_budget_dimension", {
                            "doc": "Task",
                            "docname": target_task
                        })
                        _debug_log(f"      Added missing Task dimension: {target_task}")
            else:
                doc = frappe.new_doc("Project Budget")
                doc.pb_project = project
                doc.pb_account = applicable_account

                if has_task_dimension:
                    target_task = acc_data.get('task_for_revenue') or task
                    doc.append("project_budget_dimension", {
                        "doc": "Task",
                        "docname": target_task
                    })
                    _debug_log(f"      Added Task dimension: {target_task}")

                doc.insert()
                _debug_log(f"      Created new Project Budget: {doc.name}")

            # Обновляем прогноз для периода
            amount_exists = False
            for amount_row in doc.project_budget_amount:
                if int(amount_row.pba_year) == int(year) and int(amount_row.pba_month) == int(month):
                    old_value = amount_row.pba_expected
                    amount_row.pba_expected = amount_row.pba_expected + total_amount if amount_exists else total_amount
                    amount_exists = True
                    _debug_log(f"      >>> UPDATED amount for {year}-{month}: {old_value} -> {amount_row.pba_expected}")
                    break

            if not amount_exists:
                doc.append("project_budget_amount", {
                    "pba_year": year,
                    "pba_month": month,
                    "pba_expected": total_amount
                })
                _debug_log(f"      Added NEW amount for {year}-{month}: {total_amount}")

            doc.save()
            updated_count += 1
            _debug_log(f"      Saved Project Budget: {doc.name}")

            results.append({
                'task': task,
                'year': year,
                'month': month,
                'total_amount': total_amount,
                'account': applicable_account,
                'users': users_list
            })

        # ========== ПОДЪЁМ ПРОГНОЗА НА РОДИТЕЛЬСКИЙ УРОВЕНЬ ==========
        _debug_log("STEP 8.5: Rolling up forecast to parent level")

        parent_period_map = {}
        for key, acc_data in aggregated_by_account_for_task.items():
            if not acc_data.get('has_task_dimension'):
                continue

            account = acc_data['account']
            year = acc_data['year']
            month = acc_data['month']

            if account not in parent_period_map:
                parent_period_map[account] = {}
            parent_period_map[account][(year, month)] = (
                parent_period_map[account].get((year, month), 0) + acc_data['total_amount']
            )

        for account, period_map in parent_period_map.items():
            _debug_log(f"      Parent rollup: account={account}, periods={len(period_map)}")
            _set_forecast_in_budget(
                project=project,
                account=account,
                dimensions=[],
                period_amount_map=period_map
            )
            updated_count += 1

    if should_stop:
        _debug_log("STEP 9: Stopped due to confirmation request")
    else:
        _debug_log("STEP 9: Calculations completed")
        _debug_log(f"  Total results: {len(results)}")
        _debug_log(f"  Budget records updated: {updated_count}")

        frappe.log(f"Forecast ({forecast_type}) added: {updated_count} budget records updated")

    return {
        'success': True,
        'message': f'Рассчитано {len(results)} сумм. Обновлено {updated_count} записей в бюджете.',
        'results': results,
        'updated_count': updated_count
    }


def run_add_forecast_from_work_efforts(fd):
    """Add P&L forecast from work efforts (PWE/PWA). ISS-2025-03107."""
    if fd is None:
        fd = {}
    if not isinstance(fd, frappe._dict):
        fd = frappe._dict(fd)

    frappe.has_permission("Project Budget", "write", throw=True)
    project, selected_tasks, forecast_details, confirm_recalc, forecast_type, income_account = _parse_inputs(fd)
    _debug_log(f"confirm_recalc: {confirm_recalc}")
    _debug_log(f"project: {project}")

    if not project:
        frappe.log("ERROR: No project specified")
        return {
            'success': False,
            'error': 'No project specified'
        }
    elif not selected_tasks:
        frappe.log("ERROR: No tasks selected")
        return {
            'success': False,
            'error': 'No tasks selected'
        }
    else:
        if forecast_type == "both":
            cost_result = _process_single_forecast_type(
                project, selected_tasks, forecast_details, confirm_recalc,
                "cost", None
            )
            if not cost_result.get("success"):
                return cost_result

            revenue_result = _process_single_forecast_type(
                project, selected_tasks, forecast_details, True,
                "revenue", income_account
            )
            if not revenue_result.get("success"):
                revenue_result["message"] = (
                    f"Затраты обновлены ({cost_result.get('updated_count', 0)} записей). "
                    f"Ошибка выручки: {revenue_result.get('error', '')}"
                )
                return revenue_result

            return {
                'success': True,
                'message': (
                    f"Затраты: {cost_result.get('updated_count', 0)} записей. "
                    f"Выручка: {revenue_result.get('updated_count', 0)} записей."
                ),
                'results': (cost_result.get('results', []) + revenue_result.get('results', [])),
                'updated_count': cost_result.get('updated_count', 0) + revenue_result.get('updated_count', 0)
            }
        else:
            return _process_single_forecast_type(
                project, selected_tasks, forecast_details, confirm_recalc,
                forecast_type, income_account
            )
