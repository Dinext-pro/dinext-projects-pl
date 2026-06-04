/* ISS-2025-03107: P&L menu item "На основании прогноза трудозатрат". */
frappe.provide("dinext_projects");

const DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG = "__dinext_pl_forecast_from_we";

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
        label: __("На основании прогноза трудозатрат"),
        action: add_forecast_from_work_efforts_handler,
        [DINEXT_PL_FORECAST_FROM_WE_MENU_FLAG]: true,
    });
    if (typeof dinext_projects.refresh_pl_forecast_dropdown === "function") {
        dinext_projects.refresh_pl_forecast_dropdown(frm);
    }
}

function show_tasks_selection_dialog(frm) {
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
                
                // Создаем диалог
                let dialog = new frappe.ui.Dialog({
                    title: __("Выберите задачи для добавления прогноза в бюджет"),
                    size: "large",
                    fields: [
                        {
                            fieldtype: "HTML",
                            fieldname: "table_container",
                            options: `<div class="tasks-datatable-container" style="height: ${tableHeight}px; width: 100%; overflow: auto; border: 1px solid #d1d8dd; border-radius: 4px;"></div>`
                        },
                        {
                            fieldtype: "HTML",
                            fieldname: "info_html",
                            options: `
                                <div class="text-muted" style="margin-top: 10px; padding: 8px 10px; background: var(--bg-light-gray); border-radius: 4px; font-size: 12px;">
                                    <i class="fa fa-info-circle" style="margin-right: 5px;"></i>
                                    <strong>${__("Отметьте галочками задачи для добавления прогноза")}</strong>
                                    <br><small>${__("В бюджет будут добавлены прогнозные часы по всем ролям")}</small>
                                </div>
                            `
                        }
                    ],
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
                        
                        dialog.hide();
                        add_forecast_to_budget(frm, selectedTasks, tasksDetails);
                    },
                    secondary_action_label: __("Отмена"),
                    secondary_action: function() {
                        dialog.hide();
                    }
                });
                
                dialog.show();
                
                // Создаем DataTable
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
                    
                    // Скрываем чекбоксы для строк без данных
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

function add_forecast_to_budget(frm, selectedTasks, tasksDetails, confirmRecalc = false) {
    if (!selectedTasks || selectedTasks.length === 0) {
        frappe.msgprint(__("Не выбрано ни одной задачи"));
        return;
    }
    
    // Фильтруем детализацию только по выбранным задачам
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
            confirm_recalc: confirmRecalc  // добавляем флаг подтверждения
        },
        freeze: true,
        freeze_message: __("Добавление прогноза в бюджет..."),
        callback: function(r) {
            if (r.message && r.message.success) {
                frappe.show_alert({
                    message: __("Прогноз успешно добавлен. Обновлено {0} записей.", [r.message.updated_count || 0]),
                    indicator: 'green'
                }, 5);
                
                clearBudgetCache();
                load_budget_data(frm, "month", true);
                render_pl_chart(frm);
                
            } else if (r.message && r.message.needs_confirmation) {
                // Показываем диалог подтверждения пересчета
                frappe.confirm(
                    __("Обнаружено превышение загрузки над прогнозом. Желаете выполнить пересчёт прогноза на основе текущей загрузки?"),
                    () => {
                        // Повторный вызов с подтверждением
                        add_forecast_to_budget(frm, selectedTasks, tasksDetails, true);
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

function add_forecast_from_work_efforts_handler(frm) {
    // Проверяем, что данные трудозатрат загружены
    if (!frm.aggregatedTasks || Object.keys(frm.aggregatedTasks).length === 0) {
        frappe.msgprint(__("Сначала дождитесь загрузки данных трудозатрат"));
        return;
    }
    
    // Проверяем, что данные бюджета загружены
    if (!frm.aggregatedBudget || Object.keys(frm.aggregatedBudget).length === 0) {
        frappe.msgprint(__("Сначала дождитесь загрузки данных бюджета"));
        return;
    }
    
    // Показываем диалог с деревом задач для выбора
    show_tasks_selection_dialog(frm);
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
