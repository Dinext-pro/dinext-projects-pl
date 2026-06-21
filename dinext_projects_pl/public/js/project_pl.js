// Клиентский скрипт для Doctype "Project"
frappe.ui.form.on("Project", {
    refresh: function(frm) {
        console.log("refresh");
        // При первом открытии добавляем кастомную вкладку "Трудозатраты", если ещё не создана
        render_budget_table(frm);
    }
});

/**
 * Реестр подпунктов меню "Рассчитать прогноз" над таблицей P&L.
 * Другие приложения могут добавлять пункты так:
 *   frappe.provide("dinext_projects.project_pl_forecast_menu");
 *   dinext_projects.project_pl_forecast_menu = dinext_projects.project_pl_forecast_menu || [];
 *   dinext_projects.project_pl_forecast_menu.push({ label: __("Мой прогноз"), action: function(frm) { ... } });
 * Кнопка меню отображается только если добавлен хотя бы один подпункт.
 * Если меню изменено или дополнено после первичной отрисовки кнопки, вызвать
 * dinext_projects.refresh_pl_forecast_dropdown(frm) для обновления выпадающего списка.
 */
frappe.provide("dinext_projects.project_pl_forecast_menu");
if (!Array.isArray(dinext_projects.project_pl_forecast_menu)) {
    dinext_projects.project_pl_forecast_menu = [];
}

function render_pl_chart(frm, init = true) {
    const renderChart = globalThis.render_pl_chart_impl;
    if (typeof renderChart !== "function") {
        return;
    }

    return renderChart(frm, init);
}

function add_pl_forecast_dropdown(frm, controls) {
    const raw = dinext_projects.project_pl_forecast_menu;
    const menu_array = Array.isArray(raw) ? raw : [];
    const items = menu_array.filter(
        (x) => x && typeof x.label === "string" && typeof x.action === "function"
    );
    if (items.length === 0) return;

    const $wrapper = $('<div class="pl-forecast-dropdown-wrapper dropdown"></div>');
    const $btn = $(`
        <button class="btn btn-default dropdown-toggle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
            ᛣ ${__("Добавить прогноз")}
        </button>
    `);
    const $menu = $('<ul class="dropdown-menu dropdown-menu-right" role="menu"></ul>');

    items.forEach((item) => {
        const $li = $('<li role="presentation"></li>');
        const $a = $(`<a class="dropdown-item" href="#" role="menuitem">${item.label}</a>`);
        $a.on("click", function(e) {
            e.preventDefault();
            item.action(frm);
            $wrapper.find(".dropdown-menu").removeClass("show");
            $btn.removeClass("show");
        });
        $li.append($a);
        $menu.append($li);
    });

    $wrapper.append($btn).append($menu);
    controls.append($wrapper);
}

function refresh_pl_forecast_dropdown(frm) {
    const $planning = frm.get_field("custom_planning") && frm.get_field("custom_planning").$wrapper;
    if (!$planning || !$planning.length) return;
    const $existing = $planning.find(".pl-forecast-dropdown-wrapper");
    let $controls = $existing.length ? $existing.parent() : $planning.find(".budget-controls");
    if (!$controls || !$controls.length) return;
    if ($existing.length) $existing.remove();
    add_pl_forecast_dropdown(frm, $controls);
}

frappe.provide("dinext_projects");
dinext_projects.refresh_pl_forecast_dropdown = refresh_pl_forecast_dropdown;

function addBudgetViewOptionsControl(frm, controls) {
    frm.budget_view_options = frm.budget_view_options || __("Forecast and actual");
    const control = frappe.ui.form.make_control({
		parent: controls,
		df: {
			fieldtype: 'Select',
			fieldname: "view-options",
			options: [
                __("Forecast and actual"),
                __("Forecast only"),
                __("Actual only"),
            ],
			get_status: function(i) {
                return "Write";
            },
            change: async function(i){
                if ( this.value != this.last_value ) {
                    frm.budget_view_options = this.value;
                    updateBudgetTable( frm, "month", "hours" );
                    render_pl_chart(frm);
                }
            }
		},
		value: frm.budget_view_options,
		only_input: true,
        render_input: true
	});
}

/**
 * Отрисовка таблицы «Трудозатраты»
 */
function render_budget_table(frm) {
    let wrapper = frm.get_field("custom_planning").$wrapper;
    wrapper.addClass("budget-container").empty();;

    // Создаем панель для переключателей (период, единицы измерения) и для таблицы
    let controls = $('<div class="budget-controls"></div>').appendTo(wrapper);
    let table_container = $('<div class="budget-table"></div>').appendTo(wrapper);

    // Пример переключателей
    controls.append(`
        <!--<select id="bg-period_filter" class="btn btn-default">
            <option selected value="month">Месяц</option>
            <option value="quarter">Квартал</option>
            <option value="year">Год</option>
        </select>-->
        <button class="btn btn-default" id="bg-save_plan">${__('Сохранить план')}</button>
        <button class="btn btn-default" id="bg-toggle_plan">${__("Показать план")}</button>
        <button class="btn btn-default" id="bg-toggle_delta">${__("Показать Δ")}</button>
        <!--<button class="btn btn-default" id="bg-toggle_empty">${__("Показать пустые строки")}</button>-->
    `);

    let selectedPeriodType = "month";
    // Флаги для скрытия плана и дельты – по умолчанию показывать
    frm.bg_hide_plan = frm.bg_hide_plan || true;
    frm.bg_hide_delta = frm.bg_hide_delta || true;
    frm.bg_hide_empty = frm.bg_hide_empty || true;
    
    addBudgetViewOptionsControl(frm, controls);
    add_pl_forecast_dropdown(frm, controls);

    controls.find('#bg-save_plan').on('click', function() {
        frappe.confirm(
            __("Вы уверены, что хотите сохранить текущие прогнозные / фактические данные как плановые?"),
            () => {
                save_bg_forecast_as_plan(frm);
            },
            () => {
                frappe.show_alert(__("Операция отменена"), 3);
            }
        );
    });
    
    //Обработчики кнопок Toggle
    controls.find('#bg-toggle_plan').on('click', function() {
        frm.bg_hide_plan = !frm.bg_hide_plan;
        // Обновляем текст кнопки
        $(this).text(frm.bg_hide_plan ? __("Показать план") : __("Скрыть план"));
        updateBudgetTable(frm, selectedPeriodType);
        render_pl_chart(frm);
    });
    controls.find('#bg-toggle_delta').on('click', function() {
        frm.bg_hide_delta = !frm.bg_hide_delta;
        $(this).text(frm.bg_hide_delta ? __("Показать Δ") : __("Скрыть Δ"));
        updateBudgetTable(frm, selectedPeriodType);
    });
    controls.find('#bg-toggle_empty').on('click', function() {
        frm.bg_hide_empty = !frm.bg_hide_empty;
        $(this).text(frm.bg_hide_empty ? __("Показать пустые строки") : __("Скрыть пустые строки"));
        updateBudgetTable(frm, selectedPeriodType);
    });

    // Инициализация таблицы с колонками
    function init_budget_table() {
        let columns = get_budget_columns_definition(frm, selectedPeriodType);

        // Инициализируем frappe‑datatable (параметры можно дорабатывать по необходимости)
        frm.budget_dt = new StickyDataTable(table_container[0], {
            stickyColumnsCount: 3,
            columns: columns,
            data: [], // данные будут подгружаться динамически
            inlineFilters: false,
            layout: "fixed",//fixed, fluid,ratio
            logs: true,
            disableReorderColumn: true,
            serialNoColumn: true,
            checkboxColumn: true,
            checkedRowStatus: true,
            dynamicRowHeight: true,
            showTotalRow: true,
            cellHeight: 30, //Для динамической высоты строк
            treeView: true,
            freezeMessage: __("Идет загрузка данных.."),
            hooks: {
                //Определение значений для итоговой строки
                columnTotal(columnValues, cell) {
                    // В первой колонке пишем "Баланс" / "Рентабельность"
                    if ( cell.colIndex == 2 ) {
                        this.periods = get_budget_display_periods(frm, selectedPeriodType);
                        return "<span class='profit'>" + __("Валовая прибыль") + "</span><span class='profitability'>" +  __("Рентабельность") + "</span>";
                    }
                    // В последней колонке (total) считаем итог
                    if (cell.column.id === "total") {
                        return budget_total(frm, cell, this.periods );
                    }
                    // В остальных периодических колонках
                    let m = cell.column.id.match(/^group_(\d+)_(\d+)$/);
                    if (m) {
                        let year = parseInt(m[1]), month = parseInt(m[2]);
                        return budget_column_total(frm, cell, this.periods, { year, month });
                    }
                    return "";
                }
             }
        });

        // Загружаем данные в таблицу
        load_budget_data(frm, selectedPeriodType );
    }
    init_budget_table();
}

function budget_total( frm, cell, periods ) {
    let plan_income_sum = 0;
    let plan_expenses_sum = 0;
    let actual_income_sum = 0;
    let actual_expenses_sum = 0;
    let is_past = false;
    let roots = getFinancialRootRows(frm.aggregatedBudget);
    
    periods.forEach(function(period) {
        let r = calc_column_total( frm, period, roots, !frm.bg_hide_plan );
        plan_income_sum += r.plan_income;
        plan_expenses_sum += r.plan_expenses;
        actual_income_sum += r.actual_income;
        actual_expenses_sum += r.actual_expenses;
        is_past = period.is_past;
    });
    
    return budget_total_cell( { year: "", month: "", is_past: is_past }, plan_income_sum, plan_expenses_sum, actual_income_sum, actual_expenses_sum );
}

function budget_column_total( frm, cell, periods, current ) {
    let period = periods.find(p => p.year == current.year && p.month == current.month );
    
    let roots = getFinancialRootRows(frm.aggregatedBudget);
    let r = calc_column_total( frm, period, roots, !frm.bg_hide_plan );
    
    return budget_total_cell( period, r.plan_income, r.plan_expenses, r.actual_income, r.actual_expenses );
}

function budget_total_cell( period, plan_income, plan_expenses, actual_income, actual_expenses ) {
    const profit_plan = plan_income - plan_expenses;
    const profit_actual = actual_income - actual_expenses;
    const plan_class = profit_plan > 0 ? "text-success" : ( profit_plan < 0 ? "text-danger" : "" );
    const actual_class = profit_actual > 0 ? "text-success" : ( profit_actual < 0 ? "text-danger" : "" );
    
    const profitability_plan = plan_income ? (profit_plan / plan_income * 100).toFixed(1) : "";
    const profitability_actual = actual_income ? (profit_actual / actual_income * 100).toFixed(1) : "";
    
    return budget_cell( "", "", period, profit_plan, profit_actual, true, "", plan_class, actual_class ) + 
        budget_cell( "", "", period, profitability_plan, profitability_actual, true, "%" );
}

/**
 * Определение перечня периодов для отображения (здесь реализован вариант для месяца)
 */
function get_budget_display_periods(frm, periodType) {
    let periods = [];
    
    // Если даты не заданы, возвращаем пустой массив
    if (!frm.doc.expected_start_date || !frm.doc.expected_end_date) {
        console.warn("Даты проекта не заданы");
        return periods;
    }
    
    let month_start = frappe.datetime.month_start();
    let start = frappe.datetime.str_to_obj(frm.doc.expected_start_date);
    let end = frappe.datetime.str_to_obj(frm.doc.expected_end_date);
    
    // Корректируем начальную дату на ПЕРВЫЙ ЧИСЛО месяца старта
    // Это ключевое изменение!
    let current = new Date(start.getFullYear(), start.getMonth(), 1);
    
    // Корректируем конечную дату на ПЕРВОЕ ЧИСЛО месяца окончания
    let last = new Date(end.getFullYear(), end.getMonth(), 1);
    
    if (periodType === "month") {
        // Итерируемся по месяцам, пока current <= last
        while (current <= last) {
            let year = current.getFullYear();
            let month = current.getMonth() + 1; // +1 потому что getMonth() возвращает 0-11
            
            // Определяем, является ли период прошлым
            let is_past;
            if (frm.budget_view_options == __("Actual only")) {
                is_past = true;
            } else if (frm.budget_view_options == __("Forecast only")) {
                is_past = false;
            } else { // "Forecast and actual"
                let current_date_str = frappe.datetime.obj_to_str(current);
                is_past = current_date_str < month_start;
            }
            
            periods.push({ 
                year: year, 
                month: month, 
                is_past: is_past 
            });
            
            // Переходим к следующему месяцу
            current = frappe.datetime.str_to_obj(
                frappe.datetime.add_months(
                    frappe.datetime.obj_to_str(current), 
                    1
                )
            );
        }
    }
    
    else if (periodType === "quarter") {
        let lastQuarter = null;
        let lastYear = null;
        
        while (current <= last) {
            const year = current.getFullYear();
            const quarter = Math.floor(current.getMonth() / 3) + 1;
            
            // Добавляем квартал только если он отличается от предыдущего
            if (lastQuarter !== quarter || lastYear !== year) {
                // Для квартала определяем is_past по последнему месяцу квартала
                let quarterEndMonth = quarter * 3 - 1; // 0-11 формат
                let quarterEndDate = new Date(year, quarterEndMonth, 1);
                let quarterEndDateStr = frappe.datetime.obj_to_str(quarterEndDate);
                
                let is_past;
                if (frm.budget_view_options == __("Actual only")) {
                    is_past = true;
                } else if (frm.budget_view_options == __("Forecast only")) {
                    is_past = false;
                } else {
                    is_past = quarterEndDateStr < month_start;
                }
                
                periods.push({ 
                    year: year, 
                    quarter: quarter, 
                    is_past: is_past 
                });
                
                lastQuarter = quarter;
                lastYear = year;
            }
            
            // Переходим к следующему месяцу
            current = frappe.datetime.str_to_obj(
                frappe.datetime.add_months(
                    frappe.datetime.obj_to_str(current), 
                    1
                )
            );
        }
    }
    
    else if (periodType === "year") {
        let lastYear = null;
        
        while (current <= last) {
            const year = current.getFullYear();
            
            // Добавляем год только если он отличается от предыдущего
            if (lastYear !== year) {
                // Для года определяем is_past по декабрю
                let yearEndDate = new Date(year, 11, 1); // Декабрь
                let yearEndDateStr = frappe.datetime.obj_to_str(yearEndDate);
                
                let is_past;
                if (frm.budget_view_options == __("Actual only")) {
                    is_past = true;
                } else if (frm.budget_view_options == __("Forecast only")) {
                    is_past = false;
                } else {
                    is_past = yearEndDateStr < month_start;
                }
                
                periods.push({ 
                    year: year, 
                    quarter: 0, 
                    is_past: is_past 
                });
                
                lastYear = year;
            }
            
            // Переходим к следующему месяцу
            current = frappe.datetime.str_to_obj(
                frappe.datetime.add_months(
                    frappe.datetime.obj_to_str(current), 
                    1
                )
            );
        }
    }
    
    console.log("Сгенерированы периоды:", periods);
    return periods;
}

function updateBudgetTable(frm, periodType="month") {
    let visibleRows =  frm.budget_dt.bodyRenderer.visibleRowIndices;
    
    refreshBudget( frm, frm.aggregatedBudget, get_budget_columns_definition(frm, periodType) );
    
    frm.budget_dt.rowmanager.collapseAllNodes();
    frm.budget_dt.rowmanager.showRows(visibleRows);
    cur_frm.budget_dt.bodyScrollable.dispatchEvent(new CustomEvent('scroll'));
}

globalThis.updateTaskDimension = (frm, updateRows=false) => {
    if (!frm.aggregatedBudget) return;
    if (frm.aggregatedTasks) {
        updateTaskDimensionOptimized(frm);
    } 
    
    addRiskDimensionRows(frm.aggregatedBudget);
    rollup_fact_budget( frm.aggregatedBudget );

    let visibleRows;
    if (updateRows) {
        visibleRows =  frm.budget_dt.bodyRenderer.visibleRowIndices;
    }
    //console.timeLog("updateTaskDimension");
    refreshBudget( frm, frm.aggregatedBudget );
    frm.budget_dt.rowmanager.collapseAllNodes();

    if ( visibleRows ) {
        frm.budget_dt.rowmanager.showRows(visibleRows);
    } else {
        frm.budget_dt.rowmanager.setTreeDepth(1);
    }
    //console.timeEnd("updateTaskDimension");
    render_pl_chart(frm);
}

function dimensionsEqual(dim1, dim2) {
    if (!Array.isArray(dim1) || !Array.isArray(dim2)) return false;
    if (dim1.length !== dim2.length) return false;
    for (let i = 0; i < dim1.length; i++) {
        if ( ( dim1[i].doc != dim2[i].doc ) || ( dim1[i].docname != dim2[i].docname ) ) {
            return false;
        }
    }
    return true;
}

const EXCLUDED_DIMENSIONS = ["Project", "Cost Center", "Project Portfolio"];

/**
 * Загрузка данных бюджета
 */
 //erpnext.accounts.doctype.accounting_dimension.accounting_dimension.get_dimensions(with_cost_center_and_project=False)
function load_budget_data(frm, periodType, updateRows) {
    frm.budget_dt.freeze();
    console.time("load_budget_data");
    // Массив для итоговых данных таблицы
    clearBudgetIndexCacheFor( frm.aggregatedBudget );
    let table_data = [];
    let aggregated = {};
    
    frappe.db.get_list('Account', {
        fields: ['name', 'account_name', "is_group", "parent_account", "account_currency", "root_type"],
        filters: {
            disabled: false,
            report_type: "Profit and Loss",
            company: frm.doc.company
        },
        order_by: 'root_type desc',
        limit: 0
    }).then(accounts => {
        // nodes — плоский массив { value, title, expandable, parent_account, indent }
        // строим базовую структуру aggregated по всем узлам
        let saveAggregated = function(parent, fullNodes, level ) {
            let nodes = fullNodes.filter(r => r.parent_account == parent);
            nodes?.forEach(n => {
                if (!aggregated[n.value]) {
                    aggregated[n.value] = Object.assign({}, n);
                    aggregated[n.value].indent = level;
                    aggregated[n.value].dimension_data = [{dimensions:[]}];
                    aggregated[n.value].allowed_dimensions = [];
                    
                    saveAggregated( n.value, fullNodes, level + 1 );
                }
            });
        };
        saveAggregated( 
            null, 
            accounts.map(n => {
                return {
                    value: n.value || n.name,
                    account: n.value || n.account_name,
                    expandable: n.is_group ,
                    parent_account: n.parent_account,
                    type: n.root_type
                };
            }), 0 );
        
        frappe.db.get_list("Accounting Dimension Filter", {
            filters: {
                company: frm.doc.company,
                disabled: false
            },
            fields: ["name"],
            limit: 0
        }).then(filters => {
            // получить полные документы, чтобы добрать child-таблицу accounts
            return Promise.all(filters.map(f =>
                frappe.db.get_doc("Accounting Dimension Filter", f.name)
            ));
        }).then(filterDocs => {
            return new Promise(async (resolve, reject) => {
                frm.allowed_dimensions = [];
                for (const fdoc of filterDocs) {
                    // fdoc.accounting_dimension — ссылка на Dimension
                    let dimension = fdoc.accounting_dimension;
                    
                    if ( !EXCLUDED_DIMENSIONS.includes( dimension) ) {
                        dim = await frappe.db.get_doc("Accounting Dimension", dimension);
                        if ( dim ) {
                            fdoc.accounts.forEach(acc => {
                                let acct = acc.applicable_on_account;
                                if (aggregated[acct]) {
                                    aggregated[acct].allowed_dimensions.push({
                                        document_type: dim.document_type,
                                        is_mandatory: acc.is_mandatory
                                    });
                                    frm.allowed_dimensions.push( dim.document_type );
                                }
                            }); 
                        }
                    }
                }
                frm.allowed_dimensions = [...new Set( frm.allowed_dimensions )];
                resolve();
            });
        }).then(() => {/**/
            // 2. Загрузить Project Budget (план/прогноз)
            frappe.db.get_list("Project Budget", {
                filters: { pb_project: frm.doc.name },
                //fields: ["name", "pb_account", "project_budget_dimension"],
                limit: 0
            }).then(list => {
                return Promise.all(list.map(x => frappe.db.get_doc("Project Budget", x.name)));
            }).then(bg_docs => {
                
                bg_docs.forEach(doc => {
                    let acct = doc.pb_account;

                    if ( !aggregated[acct] ) return;
                    
                    let dimensions = doc.project_budget_dimension;
                    
                    /*dimensions.forEach(dim => {
                        if ( dim.doc && dim.docname ) {
                            //Загружаем наименование объекта-измерения (задачи и пр.)
                            frappe.call({
                                method: 'frappe.desk.search.get_link_title',
                                args: {
                                    doctype: dim.doc,
                                    docname: dim.docname
                                },
                                callback: function(r) {
                                    dim.title = r.message;
                                }
                            });
                        }
                    });/**/
                    
                    let bucket = aggregated[acct].dimension_data
                        .find( x => dimensionsEqual( x.dimensions, dimensions) );
                        
                    if (!bucket) {
                        bucket = { dimensions: dimensions };
                        aggregated[acct].dimension_data.push(bucket);
                    }
                    bucket.pb_docname = doc.name;

                    doc.project_budget_amount.forEach(line => {
                        bucket[`plan_${line.pba_year}_${line.pba_month}`] = line.pba_plan;
                        bucket[`forecast_${line.pba_year}_${line.pba_month}`] = line.pba_expected;
                    });
                });
                
                // 3. Загрузить фактические из GL Entry
                let account_keys = Object.keys(aggregated);

                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'GL Entry',
                        filters: [
                            ["account", "in", account_keys.length > 0 ? account_keys : ["~~"]],
                            ["project", "=", frm.docname],
                            ["company", "=", frm.doc.company],
                            ["is_cancelled", "=", false]
                        ],
                        fields: ["account", "posting_date", "debit", "credit", "task"],
                        limit_page_length: 0
                    },
                    callback: function(r) {
                        if (r.message) {
                            let glEntries = [];
                            if (Array.isArray(r.message)) {
                                glEntries = r.message;
                            } else if (r.message.data && Array.isArray(r.message.data)) {
                                glEntries = r.message.data;
                            } else if (r.message.values && Array.isArray(r.message.values)) {
                                glEntries = r.message.values;
                            }

                            glEntries.forEach(e => {
                                let acct = e.account;
                                if (!aggregated[acct]) return;

                                let dim = ( frm.allowed_dimensions.filter( dim => e[ frappe.model.scrub( dim )] && 1 )
                                    .map( dim => { return { doc: dim, docname: e[ frappe.model.scrub( dim ) ] }; } ) ) || [];

                                let bucket = aggregated[acct].dimension_data
                                    .find( x => dimensionsEqual( x.dimensions, dim) );

                                if (!bucket) {
                                    bucket = { dimensions: dim };
                                    aggregated[acct].dimension_data.push(bucket);
                                }
                                let dt = new Date(e.posting_date);
                                let y = dt.getFullYear(), m = dt.getMonth() + 1;
                                let key = `fact_${y}_${m}`;
                                bucket[key] = (bucket[key] || 0) + signedGlPlActualAmount(
                                    aggregated[acct].type,
                                    e.debit,
                                    e.credit
                                );
                            });

                            console.timeLog("load_budget_data");
                            frm.aggregatedBudget = aggregated;
                            updateTaskDimension(frm);
                            frm.budget_dt.unfreeze();
                        }
                    },
                    error: function(err) {
                        frappe.msgprint(__("Ошибка при загрузке данных GL Entry"));
                        console.error(err);
                    }
                }).then(() => {
                    console.timeEnd("load_budget_data");
                    setBudgetCellStyles();
                    render_revenue_percentage_chart(frm);
                });
            }).catch(err => {
                frappe.msgprint(__("Ошибка при загрузке данных Project Budget"));
                console.error(err);
            });
        }).catch(err => {
            frappe.msgprint(__("Ошибка при загрузке данных Accounting Dimension Filter"));
            console.error(err);
        })/**/
    });
}

function refreshBudget( frm, aggregated, columns ) {
    const treeOrdered = aggregatedBudgetToTreeOrder(aggregated);
    if ( frm.bg_hide_empty ) {
        frm.budget_dt.refresh( treeOrdered, columns );
    } else {
        frm.budget_dt.refresh( treeOrdered, columns );
    }
}

/**
 * Строит массив строк в порядке дерева: корни, затем дочерние по parent_account / task / _parentKey.
 * Строки-риски (_parentKey) включаются как дочерние к соответствующей статье/задаче.
 */
function aggregatedBudgetToTreeOrder(aggregatedBudget) {
    if (!aggregatedBudget || typeof aggregatedBudget !== "object") return [];
    const result = [];
    const seen = new Set();

    function getParentKey(row) {
        if (row._parentKey) return row._parentKey;
        if (row.task && row.task.parent_task) return row.value + row.task.parent_task;
        if (row.task) return row.value;
        return row.parent_account || null;
    }

    const roots = Object.keys(aggregatedBudget).filter(k => {
        const row = aggregatedBudget[k];
        return !row.parent_account && !row.task && !row._parentKey;
    });

    function visit(key) {
        if (seen.has(key)) return;
        seen.add(key);
        const row = aggregatedBudget[key];
        if (!row) return;
        result.push(row);
        const children = Object.keys(aggregatedBudget).filter(k => {
            if (k === key) return false;
            const r = aggregatedBudget[k];
            return getParentKey(r) === key;
        });
        children.forEach(c => visit(c));
    }

    roots.forEach(visit);
    Object.keys(aggregatedBudget).forEach(k => { if (!seen.has(k)) visit(k); });
    return result;
}

//Функция для "свертывания" (rollup) фактических данных:
//для каждой статьи суммируются фактические цифры (fact_*) из всех дочерних статей с тем же dimension.
function rollup_fact_budget(aggregatedBudget) {
    // Получаем массив задач, отсортированный по убыванию indent (то есть от самых глубоких к родительским)
    let accountsArray = Object.values(aggregatedBudget).sort((a, b) => (b.indent || 0) - (a.indent || 0));
    accountsArray.forEach(child => {
        let parentKey = child._parentKey
            ? child._parentKey
            : ( child.task?.parent_task
                ? child.value + child.task.parent_task
                : ( child.task ? child.value : child.parent_account ) );

        if ( parentKey && aggregatedBudget[ parentKey ]) {
            let parent = aggregatedBudget[ parentKey ];
            // Для каждой записи по dimension в дочерней статье
            child.dimension_data.forEach(childDimEntry => {
                let dim = child.task
                    ? childDimEntry.dimensions.filter(item => !( item.doc == "Task" && item.docname == child.task.value ))
                    : [...(childDimEntry.dimensions || [])];
                // Строки-риски: в родителя добавляем без измерения Project Risk
                if (child.risk) {
                    dim = dim.filter(item => item.doc !== "Project Risk");
                }
                if ( child.task?.parent_task ) {
                    dim.push( { doc: "Task", docname: child.task.parent_task } );
                }
                let parentDimEntry = (parent.dimension_data || []).find( x => dimensionsEqual( x.dimensions, dim ) );

                // Перебираем все свойства, начинающиеся с "fact_"
                for (let prop in childDimEntry) {
                    if (prop.startsWith("fact_")) {
                        let childFact = parseFloat(childDimEntry[prop]) || 0;
                        if (childFact) {
                            if (!parentDimEntry) {
                                parentDimEntry = { dimensions: dim };
                                parent.dimension_data.push(parentDimEntry);
                            }
                            parentDimEntry[prop] = (parseFloat(parentDimEntry[prop]) || 0) + childFact;
                        }
                    }
                }
            });
        }
    });
}/**/

function setBudgetCellStyles() {
    $(".budget-table .datatable .dt-scrollable").addClass("dt-fit-height");
};

/**
 * Формирование описания колонок таблицы
 */
function get_budget_columns_definition(frm, periodType, unit) {
    let columns = [];

    // Колонка "Статья" с иерархической структурой.
    columns.push({
        name: __("Статья"),
        id: "account",
        width: 300,
        sortable: false,
        dropdown: false,
        editable: false,
        focusable: false,
        sticky: true,
        treeView: true,
        format: (value, row, column, data) => {
            if (data && data.risk) {
                let risk = frm.doc.custom_project_risks;
                let riskLabel = "⚠ " + ( risk.find(r => r.name == data.risk.value)?.subject || data.risk.value );
                let bucket = data.dimension_data && data.dimension_data.find(b =>
                    b.dimensions && b.dimensions.some(d => d.doc === "Project Risk" && d.docname === data.risk.value)
                );
                let pb_docname = bucket && bucket.pb_docname;
                if (pb_docname) {
                    return `<span class="risk-label">${frappe.utils.escape_html(riskLabel)}</span> ` +
                        `<button data-pb-name="${frappe.utils.escape_html(pb_docname)}" ` +
                        `data-row-key="${frappe.utils.escape_html( getBudgetRowKey( data ) )}" ` +
                        `class="btn delete-risk-reserve-btn btn-default btn-sm filter-x-button" ` +
                        `title="${__("Удалить резервы на риск")}" type="button">` +
                        `<span class="filter-icon">` +
                        `<svg class="es-icon es-line icon-sm" aria-hidden="true">` +
                        `<use href="#es-small-close"></use></svg></span></button>`;
                }
                return riskLabel;
            }
            if (data && data.account != null) {
                return render_budget_row_link(data);
            }
            return value != null ? value : "";
        }
    });

    // Колонка "Измерение"
    /*columns.push({
        name: "Измерение",
        id: "dimension",
        width: 220,
        sortable: false,
        editable: false,
        focusable: false,
        sticky: true,
        dropdown: false,
        format: (value, row, column, data) => {
            const frm = cur_frm;
            let html = "";

            if ( data ) { 
                // buckets — реальные данные dimension_data
                const buckets = data.dimension_data || [];
    
                
            } else if ( value ) {
                html = value;
            }

            return html;
        }
    });/**/
    
    /*
       Вместо вложенных columns формируем одну колонку, внутри которой вручную выводим три значения.
       Для редактирования (если период текущий или будущий) мы делаем значение "факт/прогноз" кликабельным.
    */
    let periods = get_budget_display_periods(frm, periodType);
    let subcolumn_label;
    periods.forEach(function(period) {
        // Вычисляем: если период в прошлом – отображаем "факт", иначе "прогноз"
        subcolumn_label = period.is_past ? __("Факт") : __("Прогноз");
        columns.push({
            name: `<div style="text-align:center;">
                    ${period.year} ${period.month}<br/>
                    <div class="budget-group-header">` +
                        (cur_frm.bg_hide_plan ? "" : `<span>${__("План")}</span>`) +
                        `<span>${subcolumn_label}</span>` +
                        (cur_frm.bg_hide_delta ? "" : `<span>Δ</span>`) +
                    `</div>
               </div>`,
            id: `group_${period.year}_${period.month}`,
            sortable: false,
            get width() {
                return 210 - (cur_frm.bg_hide_plan ? 70 : 0 ) - (cur_frm.bg_hide_delta ? 50 : 0);
            },
            dropdown: false,
            focusable: false,
            editable: false,
            format: budget_cell_formatter.bind(null, frm, period)
        });
    });
    
    // Добавляем колонку "Итого" – суммарные значения по всем периодам
    columns.push({
        name: `<div style="text-align:center;">
                    ${__("Итого")}<br/>
                    <div class="budget-group-header">` +
                        (cur_frm.bg_hide_plan ? "" : `<span>${__("План")}</span>`) +
                        `<span>${ subcolumn_label }</span>` +
                        (cur_frm.bg_hide_delta ? "" : `<span>Δ</span>`) +
                    `</div>
               </div>`,
        id: "total",
        get width() {
                return 210 - (cur_frm.bg_hide_plan ? 70 : 0 ) - (cur_frm.bg_hide_delta ? 50 : 0);
            },
        sortable: false,
        dropdown: false,
        focusable: false,
        editable: false,
        format: budget_cell_formatter_total.bind(null, frm, periods)
    });/**/

    return columns;
}

/**
 * Formatter для обычных ячеек бюджета
 */
function budget_cell_formatter(frm, period, value, row, col, data) {
    let lines = "";
    
    if ( data ) {
        let buckets = data.dimension_data || [];
        
        if ( !buckets.length) {
            buckets.push({});
        }
        
        buckets.forEach(function(bucket) {
            lines += budget_cell_line( period, bucket, data, false );
        });
        
    } else if ( value ) {
        lines = value;
    }
    return lines;
}

function budget_cell_line( period, bucket, data, readOnly=false ) {
    let line = "";
    
    let plan = parseFloat(bucket[`plan_${period.year}_${period.month}`]) || 0;
    let actual = period.is_past
        ? (parseFloat(bucket[`fact_${period.year}_${period.month}`]) || 0)
        : (parseFloat(bucket[`forecast_${period.year}_${period.month}`]) || 0);
    let delta = plan
        ? (((actual - plan) / plan) * 100).toFixed(1)
        : 0;
    
    const dimensions = bucket.dimensions && bucket.dimensions.length ? bucket.dimensions : null;
    line += budget_cell( data.value, data.task?.value, period, plan, actual, readOnly, "", "", "", dimensions );
            
    return line;
}

function budget_cell( account, task, period, plan, actual, readOnly=false, postfix="", clPlan='', clActual='', dimensions=null ) {
    let delta = plan
        ? (((actual - plan) / plan) * 100).toFixed(1)
        : 0;
    const dimAttr = dimensions && dimensions.length
        ? ` data-dimensions="${encodeURIComponent(JSON.stringify(dimensions))}"`
        : "";
    return `<div class="budget-group" 
                 data-year="${period.year}" 
                 data-month="${period.month}"
                 data-account="${account}"
                 data-task="${task ? task: ""}"
                 data-is-past="${period.is_past}"${dimAttr}>
                 ${cur_frm.bg_hide_plan ? "" : `<div class="bg-group-plan${plan==0?" zero":""} ${clPlan}"><span class="approved-plan-link">${numberformat( plan ) + postfix}</span></div>`}
                <div class="bg-group-actual${actual==0?" zero":""}"><span class="${ ( period.is_past || readOnly ) ? "readonly-fact" : "editable-forecast" } ${clActual}">${numberformat( actual ) + postfix}</span></div>
                ${cur_frm.bg_hide_delta ? "" : `<div class="bg-group-delta${delta==0?" zero":""}"><span>${delta}%</span></div>`}
            </div>`;
}

function render_budget_row_link(data) {
    const title = frappe.utils.escape_html(data.account != null ? data.account : data.value || "");
    const account = frappe.utils.escape_html(data.value || "");
    const task = frappe.utils.escape_html(data.task?.value || "");
    return `<span class="budget-row-link" data-account="${account}" data-task="${task}">${title}</span>`;
}

function numberformat(x) {
    return Number.isFinite(x) ? x.toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") : x;
}

/**
 * Formatter для итоговой колонки "total"
 */
function budget_cell_formatter_total(frm, periods, value, row, col, data) {
    let lines = "";
    
    if ( data ) {
        let buckets = data.dimension_data || [];
        
        if ( !buckets.length) {
            buckets.push({});
        }
        
        buckets.forEach(function(bucket) {
            lines += budget_cell_line_total( frm, periods, bucket, data );
        });
        
    } else if ( value ) {
        lines = value;
    }
    return lines;
}

function budget_cell_line_total( frm, periods, bucket, data ) {
    let line = "";
    let plan = 0;
    let actual = 0;
    let is_past = false;
    //let roots = Object.values( frm.aggregatedBudget ).filter( b => b.value == data.value && b.task == data.task );
    
    periods.forEach(function(period) {
        /*let r = calc_column_total( frm, period, roots, !frm.bg_hide_plan );
        plan += ( data.type == "Income" ) ? r.plan_income : r.plan_expenses;
        actual += ( data.type == "Income" ) ? r.actual_income : r.actual_expenses;/**/
        plan += parseFloat(bucket[`plan_${period.year}_${period.month}`]) || 0;
        actual += period.is_past
            ? (parseFloat(bucket[`fact_${period.year}_${period.month}`]) || 0)
            : (parseFloat(bucket[`forecast_${period.year}_${period.month}`]) || 0);/**/
        is_past = period.is_past;
    });
    
    let delta = plan
        ? (((actual - plan) / plan) * 100).toFixed(1)
        : 0;
    
    line += budget_cell( data.value, data.task?.value, { year: "", month: "", is_past: is_past }, plan, actual, true );
            
    return line;
}

// При клике по значению "факт/прогноз" (если редактирование разрешено)
$(document).on('click', '.bg-group-actual .editable-forecast', function(e) {
    // Если уже в режиме редактирования, не обрабатываем повторный клик
    if ($(this).find('input').length > 0) return;

    let $span = $(this);
    let currentValue = $span.text().replaceAll(' ', '');

    let $input = $(`<input min="0" type="number" step="1000" size="8" class="bg-edit-input">`)
        .val(currentValue)
        .data('original-value', currentValue);

    $span.html($input);
    $input.focus();
});

function isChildOf( child, account, task, risk = null ) {
    let x = ( child.value == account && task && child.task?.parent_task == task );
    let y = ( child.value == account && !task && child.task && !child.task.parent_task );
    let z = ( child.parent_account == account && !task && !child.task && !child.risk);
    let w = ( child._parentKey === account + ( task || "" ) ) && !risk;
    return x || y || z || w;
}

let _sum_cache = {};

/** Ключ строки в aggregatedBudget (для исключения при расчёте лимита родителя). */
function getBudgetKey(account, task = null, risk = null) {
    return account + (task ? task : "") + ( risk ? RISK_KEY_SEP + risk: "" ) ;
}

/** Ключ строки в aggregatedBudget (для исключения при расчёте лимита родителя). */
function getBudgetRowKey(row) {
    return getBudgetKey( row.value, row.task?.value, row.risk?.value );
}

/* Функция для определения максимального допустимого значения в дочерней статье */
function get_parent_budget_limit(account, task, dimension, period, aggregatedBudget, risk = null) {
    let origKey = getBudgetKey( account, task , risk );
    let forecastKey = `forecast_${period.year}_${period.month}`;
    let currentAccount = aggregatedBudget[ origKey ];
    let excluded = [ origKey ];

    dimension = risk
        ? dimension.filter(item => !( item.doc == "Project Risk" && item.docname == risk ))
        : task
            ? dimension.filter(item => !( item.doc == "Task" && item.docname == task ))
            : dimension;
    
    while (currentAccount && ( currentAccount.parent_account || currentAccount.task?.parent_task ) ) {
        let parentKey = currentAccount.risk 
            ? getBudgetKey( currentAccount.value, currentAccount.task?.value )
            : currentAccount.task?.parent_task 
                ? getBudgetKey( currentAccount.value, currentAccount.task.parent_task )
                : getBudgetKey( currentAccount.task ? currentAccount.value : currentAccount.parent_account );

        let dim = [...(dimension || [])];
        if ( !currentAccount.risk && currentAccount.task?.parent_task ) {
            dim.push( { doc: "Task", docname: currentAccount.task.parent_task } );
        }

        let parent = aggregatedBudget[ parentKey ];

        if (parent) {
            let parentDimEntry = (parent.dimension_data || []).find( x => dimensionsEqual( x.dimensions, dim ) );
            let parentForecast = parentDimEntry ? parseFloat(parentDimEntry[forecastKey]) || 0 : 0;

            if (parentForecast > 0) {
                const filteredAgg = {};
                Object.keys(aggregatedBudget).forEach(k => {
                    if (excluded.indexOf(k) === -1) filteredAgg[k] = aggregatedBudget[k];
                });
                let siblingsSum = get_child_budget_sum(
                    parent.value,
                    parent.task ? parent.task.value : undefined,
                    dim,
                    period,
                    filteredAgg
                );
                let maxAllowed = parentForecast - siblingsSum;
                return { parent: parent, maxAllowed: maxAllowed, dim: dim };
            }
        }
        currentAccount = parent;
    }
    return null;
}

$(document).on('keydown', '.bg-edit-input', function(e) {
    if (event.key === "Enter") {
        // Trigger the button element with a click
        $('.bg-edit-input').blur();
      }
});

$(document).on('click', '.delete-risk-reserve-btn', function(e) {
    e.preventDefault();
    e.stopPropagation();
    let row_key = $(e.currentTarget).data('row-key');
    let pb_name = $(e.currentTarget).data('pb-name');
    if (!pb_name) return;
    frappe.confirm(
        __("Удалить резервы на риск?"),
        () => {
            frappe.call({
                method: "frappe.client.delete",
                args: { doctype: "Project Budget", name: pb_name },
                freeze: true,
                callback: function(r) {
                    if (!r.exc && cur_frm) {
                        frappe.show_alert({
                            message: __('Данные удалены'),
                            indicator: 'green'
                        }, 5);
                        load_budget_data( cur_frm, "month");                        
                    }
                    if (r.exc) {
                        frappe.msgprint(__("Ошибка при удалении резерва на риск"));
                    }
                }
            });
        },
        () => {
            frappe.show_alert(__("Операция отменена"), 3);
        }
    );
});

// При потере фокуса input – сохраняем значение
$(document).on('blur', '.bg-edit-input', function(e) {
    let $input = $(this);
    let new_value = parseFloat($input.val());

    let original_value = $input.data('original-value');
    if (new_value == original_value) {
        // Если значение не изменилось, восстанавливаем исходное отображение и выходим
        $input.parent().text( numberformat( new_value ) );
        return;
    }
    
    let $group = $input.closest('.budget-group');
    let year = $group.data('year');
    let month = $group.data('month');
    let period = { year: year, month: month };
    let account = $group.data('account');
    let task = $group.data('task');
    let dimension = [];
    try {
        const dimRaw = $group.attr('data-dimensions');
        if (dimRaw) dimension = JSON.parse(decodeURIComponent(dimRaw));
        else dimension = task ? [ { doc: "Task", docname: task } ] : [];
    } catch (e) {
        dimension = task ? [ { doc: "Task", docname: task } ] : [];
    }
    
    if ( new_value ) {
        // Получаем агрегированные данные
        let aggregatedBudget = cur_frm.aggregatedBudget || {};
        
        const taskId = dimension.find(d => d && d.doc === "Task")?.docname || task;
        const riskDim = dimension.find(d => d && d.doc === "Project Risk")?.docname;
        //const currentRowKey = account + (taskId || "") + ( riskDim ? ( RISK_KEY_SEP + riskDim.docname) : "" );

        if ( !riskDim ) {
            // Определяем, является ли текущая статья родительской (есть ли дочерние статьи)
            let isParent = Object.values( aggregatedBudget ).some(t => isChildOf( t, account, taskId, riskDim ) );

            if (isParent) {
                // В родительской статье: новое значение не должно быть меньше суммы прогнозов у дочерних задач
                let childrenSum = get_child_budget_sum(account, taskId, dimension, period, aggregatedBudget);
                if (new_value < childrenSum) {
                    frappe.msgprint(__(`Значение не может быть меньше суммы по дочерним позициям ( ${numberformat( childrenSum )} )`));
                    $input.addClass("error");
                    return;
                }
            }
        }
        
        // В дочерней: максимальное значение ограничено так, чтобы у родительской статьи (или ближайшей с заданным прогнозом) сумма всех дочерних не превышала прогноз родителя
        let parentLimit = get_parent_budget_limit(account, taskId, dimension, period, aggregatedBudget, riskDim);
        if (parentLimit !== null && (new_value > parentLimit.maxAllowed) ) {
            frappe.msgprint(__(`Значение не может превышать ${ numberformat( parentLimit.maxAllowed ) } (ограничение родительской статьи '${ parentLimit.parent.account }')` ) );
            $input.addClass("error");
            return;
        }
    }
    
    // Восстанавливаем отображение: заменяем input на span с новым значением
    $input.parent().text( numberformat( new_value || 0 ) );
    // Вызываем функцию обновления прогнозного значения на сервере
    updateBudgetValue( cur_frm.doc.name, account, dimension, year, month, new_value );
});/**/



function updateBudgetValue(project, account, dim, year, month, new_value) {
    console.log("=== updateBudgetValue ===");
    console.log("Проект:", project);
    console.log("Счет:", account);
    console.log("Измерения:", dim ? JSON.stringify(dim) : "нет измерений");
    console.log("Период:", year + "-" + month);
    console.log("Значение:", new_value);
    
    // Создаем уникальный ключ для измерений для сравнения
    const getDimensionsKey = (dimensions) => {
        if (!dimensions || dimensions.length === 0) return "NO_DIMENSIONS";
        // Сортируем чтобы порядок не имел значения
        return JSON.stringify(dimensions
            .map(d => `${d.doc}:${d.docname}`)
            .sort()
        );
    };
    
    const targetDimensionsKey = getDimensionsKey(dim);
    console.log("Ключ измерений для поиска:", targetDimensionsKey);
    
    // Шаг 1: Получаем ВСЕ документы Project Budget для этого проекта и счета
    frappe.db.get_list("Project Budget", {
        filters: [
            ["pb_project", "=", project],
            ["pb_account", "=", account]
        ],
        fields: ["name"],
        limit: 0  // Получаем все!
    }).then(allDocs => {
        console.log("Найдено документов:", allDocs.length);
        
        if (allDocs.length === 0) {
            // Если нет документов вообще - создаем новый
            console.log("Документов нет, создаем новый");
            return createNewBudgetDoc(project, account, dim, year, month, new_value);
        }
        
        // Шаг 2: Проверяем каждый документ на соответствие измерениям
        const checkPromises = allDocs.map(doc => 
            frappe.db.get_doc("Project Budget", doc.name)
        );
        
        return Promise.all(checkPromises).then(docs => {
            // Ищем подходящий документ
            let targetDoc = null;
            
            for (let i = 0; i < docs.length; i++) {
                const doc = docs[i];
                const docDimensions = doc.project_budget_dimension || [];
                const docDimensionsKey = getDimensionsKey(docDimensions);
                
                console.log(`Документ ${doc.name}: ключ измерений = ${docDimensionsKey}`);
                
                if (docDimensionsKey === targetDimensionsKey) {
                    console.log("Найден подходящий документ:", doc.name);
                    targetDoc = doc;
                    break;
                }
            }
            
            if (targetDoc) {
                // Нашли существующий документ - обновляем его
                console.log("Используем существующий документ:", targetDoc.name);
                return updateBudgetDoc(targetDoc, year, month, new_value);
            } else {
                // Не нашли - создаем новый документ
                console.log("Подходящий документ не найден, создаем новый");
                return createNewBudgetDoc(project, account, dim, year, month, new_value);
            }
        });
    }).then(result => {
        console.log("Данные успешно сохранены!");
        
        // Обновляем UI
        let task = dim?.find(d => d.doc == "Task")?.docname;
        updateBudgetDimensionEntry(cur_frm, account, task, dim, year, month, "forecast", new_value);
        if (is_pl_expense_account(cur_frm, account)) {
            sync_estimated_costing_from_forecast(cur_frm);
        }
        updateBudgetTable(cur_frm, "month");
        render_pl_chart(cur_frm, false);
        
        frappe.show_alert({
            message: __('Данные сохранены'),
            indicator: 'green'
        }, 5);
        
    }).catch(err => {
        console.error("Ошибка в updateBudgetValue:", err);
        frappe.msgprint(__("Ошибка при обновлении прогноза"));
    });
}

/**
 * Создать новый документ Project Budget
 */
function createNewBudgetDoc(project, account, dim, year, month, new_value) {
    console.log("Создание нового документа Project Budget...");
    
    const newDoc = {
        doctype: "Project Budget",
        pb_project: project,
        pb_account: account,
        project_budget_dimension: dim && dim.length > 0 ? dim.map(d => ({
            doc: d.doc,
            docname: d.docname
        })) : [],
        project_budget_amount: [{
            pba_year: year,
            pba_month: month,
            pba_expected: new_value
        }]
    };
    
    console.log("Новый документ для создания:", newDoc);
    
    return frappe.db.insert(newDoc).then(doc => {
        console.log("Документ создан:", doc.name);
        return doc;
    });
}

/**
 * Обновить существующий документ Project Budget
 */
function updateBudgetDoc(doc, year, month, new_value) {
    console.log("Обновление документа:", doc.name);
    
    // Убедимся, что массивы существуют
    if (!doc.project_budget_amount) {
        doc.project_budget_amount = [];
    }
    
    // Ищем существующую запись для этого периода
    let existingAmount = doc.project_budget_amount.find(item => 
        item.pba_year == year && item.pba_month == month
    );
    
    if (existingAmount) {
        console.log(`Обновляем сумму для ${year}-${month}: ${existingAmount.pba_expected} → ${new_value}`);
        existingAmount.pba_expected = new_value;
    } else {
        console.log(`Добавляем новую сумму для ${year}-${month}: ${new_value}`);
        doc.project_budget_amount.push({
            pba_year: year,
            pba_month: month,
            pba_expected: new_value
        });
    }
    
    // Сохраняем изменения
    return frappe.call({
        method: 'frappe.client.save',
        args: { doc: doc }
    }).then(result => {
        console.log("Документ обновлен:", doc.name);
        return doc;
    });
}


function save_bg_forecast_as_plan(frm) {
    let periods = get_budget_display_periods(frm, "month");
    let checkedRows = frm.budget_dt.rowmanager.getCheckedRows();
    
    // Собираем данные как массив объектов
    let data = [];
    
    for (let i = 0; i < checkedRows.length; i++) {
        let accObj = frm.budget_dt.datamanager.getData(checkedRows[i]);
        let account = accObj.value;
        
        if (accObj.dimension_data && Array.isArray(accObj.dimension_data)) {
            accObj.dimension_data.forEach(dimEntry => {
                let dimensions = dimEntry.dimensions || [];
                let amounts = [];
                
                periods.forEach(period => {
                    let plan_value = 0;
                    
                    if (period.is_past) {
                        let factKey = `fact_${period.year}_${period.month}`;
                        plan_value = parseFloat(dimEntry[factKey]) || 0;
                    } else {
                        let forecastKey = `forecast_${period.year}_${period.month}`;
                        plan_value = parseFloat(dimEntry[forecastKey]) || 0;
                    }
                    
                    if (plan_value > 0) {
                        // Создаем простой объект
                        amounts.push({ 
                            year: period.year,
                            month: period.month,
                            plan_value: plan_value
                        });
                    }
                });
                
                data.push({
                    account: account,
                    dimensions: dimensions,
                    amounts: amounts
                });
            });
        }
    }
    
    if (data.length === 0) {
        frappe.msgprint(__("Нет данных для сохранения."));
        return;
    }
    
    frappe.call({
        method: "dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval",
        args: {
            project: frm.doc.name,
            data: data
        },
        freeze: true,
        freeze_message: __("Отправка бюджетов на согласование..."),
        callback: function(r) {
            if (!r.exc) {
                frappe.show_alert(__("Бюджеты отправлены на согласование"), 5);
                load_budget_data(frm, "month", true);
                load_and_render_project_dashboard(frm);
            }
        }
    });
}

$(document).on('dblclick', '.budget-row-link', function(e) {
    e.preventDefault();
    e.stopPropagation();

    const account = $(e.currentTarget).data('account');
    const task = $(e.currentTarget).data('task');
    if (!account || !cur_frm?.docname) {
        return;
    }

    frappe.route_options = {
        project: cur_frm.docname,
        dinext_budget_account: account,
        budget_against: task ? "Task" : "Project",
    };
    if (task) {
        frappe.route_options.task = task;
    }
    frappe.set_route('List', 'Budget');
});

$(document).on('dblclick', '.bg-group-plan:not(.zero)', function(e) {
    e.preventDefault();
    e.stopPropagation();

    const $group = $(e.currentTarget).closest('.budget-group');
    open_approved_budget_for_group($group);
});

// При двойном клике по значению "факт"
// https://erp.dinord.ru/app/issue/ISS-2025-01237
$(document).on('dblclick', '.bg-group-actual:not(.zero):has(.readonly-fact)', function(e) {
    let $actual = $(this);

    let $group = $actual.closest('.budget-group');
    let year = $group.data('year');
    let month = $group.data('month');
    let account = $group.data('account');
    let is_past = $group.data('is-past');
    let task = $group.data('task');
    
    if ( is_past ) {
        let from_date = ( year && month ) 
            ? moment( [ year, month - 1, 1 ] ).format() 
            : cur_frm.doc.expected_start_date;
        let to_date = ( year && month ) 
            ? moment( [ year, month - 1, 1 ] ).endOf("month").format() 
            : cur_frm.doc.expected_end_date;
    
        frappe.route_options = {
            "company": cur_frm.doc.company,
            "account": account != "" ? account: Object.values(cur_frm.aggregatedBudget).map( acc => acc.value ),
            "from_date": from_date,
            "to_date": to_date,
            "from_fiscal_year":null,
            "to_fiscal_year": null,
            "cost_center":[],
            "task": task ? [ task ] : [],
            "project_role":[],
            "project":[cur_frm.docname],
        }
    	frappe.set_route('query-report', 'General Ledger');
    }
});

function open_approved_budget_for_group($group) {
    const year = $group.data('year');
    const month = $group.data('month');
    const account = $group.data('account');
    const dimRaw = $group.attr('data-dimensions');

    let dimensions = [];
    try {
        dimensions = dimRaw ? JSON.parse(decodeURIComponent(dimRaw)) : [];
    } catch (error) {
        dimensions = [];
    }

    frappe.call({
        method: "dinext_projects_pl.dinext_projects_pl.budget_approval.service.find_approved_budget_for_period",
        args: {
            project: cur_frm.docname,
            account: account,
            year: year,
            month: month,
            dimensions: dimensions,
        },
        freeze: true,
        freeze_message: __("Поиск согласованного бюджета..."),
        callback: function(r) {
            if (r.exc) {
                return;
            }
            if (!r.message) {
                frappe.msgprint(__("Для выбранной ячейки не найден согласованный Budget."));
                return;
            }
            frappe.set_route("Form", "Budget", r.message);
        }
    });
}