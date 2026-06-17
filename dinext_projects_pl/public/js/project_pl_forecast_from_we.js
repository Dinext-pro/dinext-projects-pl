/* ISS-2025-03107 / ISS-2025-02857: P&L «Добавить прогноз» из прогноза трудозатрат. */
frappe.provide("dinext_projects");

const DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG = "__dinext_pl_forecast_from_we";
const DINEXT_PL_FORECAST_COST_LABEL = __("Затрат на основании прогноза трудозатрат");
const DINEXT_PL_FORECAST_REVENUE_LABEL = __("Выручки на основании прогноза трудозатрат");

function dinext_pl_is_tm_project(frm) {
    return frm.doc.custom_payment_scheme === "Время и затраты (T&M)";
}

function dinext_pl_register_forecast_from_we_menu(frm) {
    if (!frm || frm.is_new()) {
        return;
    }
    frappe.provide("dinext_projects.project_pl_forecast_menu");
    if (!Array.isArray(dinext_projects.project_pl_forecast_menu)) {
        dinext_projects.project_pl_forecast_menu = [];
    }
    dinext_projects.project_pl_forecast_menu = dinext_projects.project_pl_forecast_menu.filter(
        (item) => !item[DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG]
    );
    dinext_projects.project_pl_forecast_menu.push({
        label: DINEXT_PL_FORECAST_COST_LABEL,
        action: (frm) => add_forecast_from_work_efforts_handler(frm, "cost"),
        [DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG]: true,
    });
    if (dinext_pl_is_tm_project(frm)) {
        dinext_projects.project_pl_forecast_menu.push({
            label: DINEXT_PL_FORECAST_REVENUE_LABEL,
            action: (frm) => add_forecast_from_work_efforts_handler(frm, "revenue"),
            [DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG]: true,
        });
    }
    if (typeof dinext_projects.refresh_pl_forecast_dropdown === "function") {
        dinext_projects.refresh_pl_forecast_dropdown(frm);
    }
}

function show_tasks_selection_dialog(frm, forecastMode = "cost") {
    let periods = get_budget_display_periods(frm, "month");
    
    frappe.show_alert({
        message: __("Загрузка данных трудозатрат..."),
        indicator: 'orange'
    }, 5);
    
    frappe.call({
        method: "get_tasks_forecast_and_workload_v2",
        args: {
            project: frm.doc.name,
            periods: periods,
            view_options: frm.budget_view_options
        },
        freeze: true,
        freeze_message: __("Загрузка данных трудозатрат..."),
        callback: function(r) {
            if (r.message && r.message.tasks) {
                let tasks = r.message.tasks;
                let tasksDetails = r.message.tasks_details;
                
                if (tasks.length === 0) {
                    frappe.msgprint(__("Нет задач с прогнозными трудозатратами или загрузкой"));
                    return;
                }
                
                // Строим данные для DataTable в формате дерева
                let allTasks = frm.aggregatedTasks ? Object.values(frm.aggregatedTasks) : [];
                let tasksMap = {};
                tasks.forEach(task => {
                    tasksMap[task.task] = task;
                });
                
                // Находим задачи с данными и их родителей
                let tasksWithData = new Set();
                allTasks.forEach(task => {
                    if (tasksMap[task.value] && (tasksMap[task.value].total_forecast > 0 || tasksMap[task.value].total_assigned > 0)) {
                        tasksWithData.add(task.value);
                    }
                });
                
                let tasksToShow = new Set(tasksWithData);
                tasksWithData.forEach(taskId => {
                    let current = allTasks.find(t => t.value === taskId);
                    while (current && current.parent_task) {
                        tasksToShow.add(current.parent_task);
                        current = allTasks.find(t => t.value === current.parent_task);
                    }
                });
                
                // Строим table_data для DataTable
                let table_data = [];
                let processedTasks = new Set();
                
                function addTaskToTable(taskId, parentId, level) {
                    if (processedTasks.has(taskId)) return;
                    
                    let task = allTasks.find(t => t.value === taskId);
                    if (!task) return;
                    
                    let taskData = tasksMap[taskId] || { total_forecast: 0, total_assigned: 0 };
                    let hasData = taskData.total_forecast > 0 || taskData.total_assigned > 0;
                    
                    table_data.push({
                        'id': taskId,
                        'value': taskId,
                        'parent': parentId,
                        'subject': task.subject || taskId,
                        'total_forecast': taskData.total_forecast || 0,
                        'total_assigned': taskData.total_assigned || 0,
                        'has_data': hasData,
                        'indent': level
                    });
                    
                    processedTasks.add(taskId);
                    
                    let children = allTasks.filter(t => t.parent_task === taskId && tasksToShow.has(t.value));
                    children.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
                    children.forEach(child => addTaskToTable(child.value, taskId, level + 1));
                }
                
                let rootTasks = allTasks.filter(t => !t.parent_task && tasksToShow.has(t.value));
                rootTasks.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
                rootTasks.forEach(task => addTaskToTable(task.value, null, 0));
                
                // Рассчитываем высоту таблицы
                let tableHeight = Math.min(500, Math.max(200, table_data.length * 30 + 40));

                const is_revenue = forecastMode === "revenue";

                function open_tasks_selection_dialog(income_accounts) {
                let dialog_fields = [
                    {
                        fieldtype: "HTML",
                        fieldname: "table_container",
                        options: `<div class="tasks-datatable-container" style="height: ${tableHeight}px; width: 100%; overflow: auto; border: 1px solid #d1d8dd; border-radius: 4px;"></div>`
                    }
                ];

                if (is_revenue) {
                    dialog_fields.push({
                        fieldtype: "Link",
                        fieldname: "income_account",
                        label: __("Счёт доходов"),
                        options: "Account",
                        reqd: true,
                        get_query: function() {
                            let filters = {
                                company: frm.doc.company,
                                root_type: "Income",
                                is_group: 0
                            };
                            if (income_accounts.length) {
                                filters.name = ["in", income_accounts];
                            } else {
                                filters.name = ["=", "__no_income_accounts__"];
                            }
                            return { filters: filters };
                        }
                    });
                }

                dialog_fields.push({
                    fieldtype: "HTML",
                    fieldname: "info_html",
                    options: `
                        <div class="text-muted" style="margin-top: 10px; padding: 8px 10px; background: var(--bg-light-gray); border-radius: 4px; font-size: 12px;">
                            <i class="fa fa-info-circle" style="margin-right: 5px;"></i>
                            <strong>${__("Отметьте галочками задачи для добавления прогноза")}</strong>
                            <br><small>${__("В бюджет будут добавлены прогнозные часы по всем ролям")}</small>
                        </div>
                    `
                });

                let dialog = new frappe.ui.Dialog({
                    title: __("Выберите задачи для добавления прогноза в бюджет"),
                    size: "large",
                    fields: dialog_fields,
                    primary_action_label: __("Добавить прогноз"),
                    primary_action: function() {
                        let checkedRows = dialog.datatable.rowmanager.getCheckedRows();
                        
                        if (!checkedRows || checkedRows.length === 0) {
                            frappe.msgprint(__("Выберите хотя бы одну задачу"));
                            return;
                        }
                        
                        let selectedTasks = [];
                        checkedRows.forEach(rowIndex => {
                            let rowData = dialog.datatable.datamanager.getData(rowIndex);
                            if (rowData && rowData.has_data) {
                                selectedTasks.push(rowData.value);
                            }
                        });
                        
                        if (selectedTasks.length === 0) {
                            frappe.msgprint(__("Выберите задачи с данными"));
                            return;
                        }
                        
                        let income_account = is_revenue ? dialog.get_value("income_account") : null;
                        
                        if (is_revenue && !income_account) {
                            frappe.msgprint(__("Выберите счёт доходов"));
                            return;
                        }
                        
                        dialog.hide();
                        add_forecast_to_budget(frm, selectedTasks, tasksDetails, false, forecastMode, income_account);
                    },
                    secondary_action_label: __("Отмена"),
                    secondary_action: function() {
                        dialog.hide();
                    }
                });
                
                dialog.show();

                if (is_revenue) {
                    if (income_accounts.length === 1) {
                        dialog.set_value("income_account", income_accounts[0]);
                    } else {
                        frappe.db.get_value("Company", frm.doc.company, "default_income_account", function(r) {
                            if (!r || !r.default_income_account) {
                                return;
                            }
                            if (!income_accounts.length || income_accounts.includes(r.default_income_account)) {
                                dialog.set_value("income_account", r.default_income_account);
                            }
                        });
                    }
                }
                
                setTimeout(() => {
                    let container = dialog.$wrapper.find('.tasks-datatable-container');
                    
                    let columns = [
                        {
                            name: __("Задача"),
                            id: "subject",
                            width: 450,
                            treeView: true,
                            sortable: false,
                            format: (value) => value || ''
                        },
                        {
                            name: __("Прогноз, ч"),
                            id: "total_forecast",
                            width: 100,
                            sortable: false,
                            format: (value, row, column, data) => {
                                if (data && data.total_forecast > 0) {
                                    return data.total_forecast.toFixed(1);
                                }
                                return '—';
                            }
                        },
                        {
                            name: __("Загрузка, ч"),
                            id: "total_assigned",
                            width: 120,
                            sortable: false,
                            format: (value, row, column, data) => {
                                if (data && data.total_assigned > 0) {
                                    return `<span style="color: #e67e22;">${data.total_assigned.toFixed(1)}</span>`;
                                }
                                return '—';
                            }
                        }
                    ];
                    
                    dialog.datatable = new StickyDataTable(container[0], {
                        columns: columns,
                        data: table_data,
                        treeView: true,
                        checkboxColumn: true,
                        checkedRowStatus: false,
                        layout: "fixed",
                        inlineFilters: false,
                        disableReorderColumn: true,
                        serialNoColumn: true,
                        cellHeight: 30
                    });
                    
                    setTimeout(() => {
                        container.find('.dt-row').each(function() {
                            let rowIndex = $(this).data('row-index');
                            if (rowIndex !== undefined && dialog.datatable.datamanager) {
                                let rowData = dialog.datatable.datamanager.getData(rowIndex);
                                
                                if (rowData && !rowData.has_data) {
                                    $(this).find('.dt-cell--col-0 input[type="checkbox"]').hide();
                                    $(this).css('background-color', '#f8f9fa');
                                }
                            }
                        });
                    }, 100);
                    
                }, 200);

                } // open_tasks_selection_dialog

                if (is_revenue) {
                    frappe.call({
                        method: "frappe.desk.search.search_link",
                        args: {
                            doctype: "Account",
                            txt: "",
                            query: "dinext_projects_pl.dinext_projects_pl.forecast_utils.get_income_accounts_with_task_dimension",
                            filters: { company: frm.doc.company },
                            page_length: 9999
                        },
                        callback: function(account_r) {
                            let income_accounts = (account_r.message || []).map((row) => row.value);
                            open_tasks_selection_dialog(income_accounts);
                        },
                        error: function() {
                            frappe.msgprint(__("Не удалось загрузить список счетов доходов"));
                        }
                    });
                } else {
                    open_tasks_selection_dialog([]);
                }
                
            } else if (r.message && r.message.error) {
                frappe.msgprint(__("Ошибка: {0}", [r.message.error]));
            } else {
                frappe.msgprint(__("Нет данных о трудозатратах"));
            }
        },
        error: function(err) {
            console.error("AJAX Error:", err);
            frappe.msgprint(__("Ошибка при загрузке данных трудозатрат"));
        }
    });
}

function reserveDimensionsKey(dimensions) {
    if (!dimensions || !dimensions.length) return "";
    return dimensions
        .filter(function(d) { return d && d.doc; })
        .map(function(d) { return (d.doc || '') + ':' + (d.docname || ''); })
        .sort()
        .join('|');
}

function reserveDimensionsEqual(dim1, dim2) {
    return reserveDimensionsKey(dim1) === reserveDimensionsKey(dim2);
}

function reloadForecastBudgetView(frm) {
    if (typeof load_budget_data === 'function') {
        load_budget_data(frm, 'month', true);
    }
}

function add_forecast_to_budget(frm, selectedTasks, tasksDetails, confirmRecalc = false, forecastType = "cost", incomeAccount = null) {
    if (!selectedTasks || selectedTasks.length === 0) {
        frappe.msgprint(__("Не выбрано ни одной задачи"));
        return;
    }

    let serverForecastType = forecastType === "revenue" ? "revenue" : "cost";
    
    let filteredDetails = {};
    selectedTasks.forEach(task => {
        if (tasksDetails[task]) {
            filteredDetails[task] = tasksDetails[task];
        }
    });
    
    frappe.show_alert({
        message: __("Добавление прогноза из трудозатрат для {0} задач...", [selectedTasks.length]),
        indicator: 'orange'
    }, 10);
    
    frappe.call({
        method: "add_forecast_from_work_efforts",
        args: {
            project: frm.doc.name,
            tasks: selectedTasks,
            forecast_details: filteredDetails,
            confirm_recalc: confirmRecalc,
            forecast_type: serverForecastType,
            income_account: incomeAccount || ""
        },
        freeze: true,
        freeze_message: __("Добавление прогноза в бюджет..."),
        callback: function(r) {
            if (r.message && r.message.success) {
                frappe.show_alert({
                    message: __("Прогноз успешно добавлен. Обновлено {0} записей.", [r.message.updated_count || 0]),
                    indicator: 'green'
                }, 5);

                // Подъём на родительские уровни (как в buildParentAdjustments для рисков)
                if (typeof buildParentAdjustments === 'function' && frm.aggregatedBudget && r.message.results) {
                    var reserveUpdates = r.message.results.map(function(item) {
                        var dimensions = [];
                        if (item.task) {
                            dimensions.push({ doc: 'Task', docname: item.task });
                        }
                        var periodKey = item.year + '_' + item.month;
                        var periodAmountMap = {};
                        periodAmountMap[periodKey] = item.total_amount;
                        return {
                            account: item.account,
                            dimensions: dimensions,
                            period_amount_map: periodAmountMap
                        };
                    });

                    var parentResult = buildParentAdjustments(frm, reserveUpdates);
                    if (parentResult.parent_adjustments && parentResult.parent_adjustments.length > 0) {
                        frappe.call({
                            method: 'dinext_risk_management.dinext_risk_management.bulk_save_reserve_budgets',
                            args: {
                                project: frm.doc.name,
                                updates: [],
                                parent_adjustments: parentResult.parent_adjustments
                            },
                            freeze: true,
                            freeze_message: __("Обновление родительских статей..."),
                            callback: function(r2) {
                                if (r2.exc) {
                                    frappe.msgprint({
                                        title: __('Ошибка'),
                                        message: r2.exc && r2.exc[0] ? r2.exc[0] : __('Ошибка при обновлении родительских статей'),
                                        indicator: 'red'
                                    });
                                    reloadForecastBudgetView(frm);
                                    return;
                                }
                                if (parentResult.adjusted_parents && parentResult.adjusted_parents.length > 0) {
                                    frappe.show_alert({
                                        message: __('Прогноз увеличен для родительских статей: {0}',
                                            [parentResult.adjusted_parents.map(function(a) { return a.account; }).join(', ')]),
                                        indicator: 'yellow'
                                    }, 5);
                                }
                                reloadForecastBudgetView(frm);
                            }
                        });
                        return;
                    }
                }

                reloadForecastBudgetView(frm);
                
            } else if (r.message && r.message.needs_confirmation) {
                frappe.confirm(
                    __("Обнаружено превышение загрузки над прогнозом. Желаете выполнить пересчёт прогноза на основе текущей загрузки?"),
                    () => {
                        add_forecast_to_budget(frm, selectedTasks, tasksDetails, true, forecastType, incomeAccount);
                    },
                    () => {
                        frappe.show_alert(__("Операция отменена"), 3);
                    }
                );
            } else if (r.message && r.message.error) {
                frappe.msgprint(__("Ошибка: {0}", [r.message.error]));
            } else {
                frappe.msgprint(__("Неизвестная ошибка"));
            }
        },
        error: function(err) {
            console.error("AJAX Error:", err);
            frappe.msgprint(__("Ошибка при добавлении прогноза"));
        }
    });
}

function clearBudgetCache() {
    _sum_cache = {};
    if (cur_frm) {
        cur_frm.aggregatedBudget = null;
    }
}

function ensureProjectWorkEffortsTasks(frm) {
    return new Promise((resolve, reject) => {
        if (frm.aggregatedTasks && Object.keys(frm.aggregatedTasks).length > 0) {
            resolve(frm.aggregatedTasks);
            return;
        }

        frappe.call({
            method: "get_work_efforts_consolidated_data",
            args: {
                project: frm.doc.name,
                view_options: frm.view_options || frm.budget_view_options || __("Прогноз и факт"),
            },
            freeze: true,
            freeze_message: __("Загрузка данных трудозатрат..."),
            callback(r) {
                if (!r.message) {
                    frappe.msgprint(__("Не удалось загрузить данные трудозатрат"));
                    reject();
                    return;
                }

                frm.aggregatedTasks = {};
                (r.message || []).forEach((task) => {
                    if (task && task.value) {
                        frm.aggregatedTasks[task.value] = task;
                    }
                });

                if (Object.keys(frm.aggregatedTasks).length === 0) {
                    frappe.msgprint(__("Нет задач с трудозатратами в проекте"));
                    reject();
                    return;
                }

                resolve(frm.aggregatedTasks);
            },
            error() {
                frappe.msgprint(__("Ошибка при загрузке данных трудозатрат"));
                reject();
            },
        });
    });
}

function add_forecast_from_work_efforts_handler(frm, forecastMode = "cost") {
    if (!frm.aggregatedBudget || Object.keys(frm.aggregatedBudget).length === 0) {
        frappe.msgprint(__("Сначала дождитесь загрузки данных бюджета"));
        return;
    }

    ensureProjectWorkEffortsTasks(frm).then(() => {
        show_tasks_selection_dialog(frm, forecastMode);
    });
}

function escape_html(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

frappe.ui.form.on("Project", {
    refresh(frm) {
        dinext_pl_register_forecast_from_we_menu(frm);
    },
});
