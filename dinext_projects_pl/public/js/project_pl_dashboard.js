//https://erp.dinord.ru/app/issue/ISS-2025-01541
frappe.ui.form.on('Project', {
	refresh: function(frm) {
		if (frm.doc.name && !frm.is_new()) {
            init_financial_metrics_reporting_date(frm);
		    add_buttons( frm );
            add_project_profit_loss_chart(frm);
            //render_pl_chart(frm);
        }
	},
})

function init_financial_metrics_reporting_date(frm) {
    if (frm._financial_metrics_reporting_date === undefined) {
        frm._financial_metrics_reporting_date =
            frm.doc.custom_metrics_reporting_date || frappe.datetime.get_today();
    }

    if (frm.get_field?.("custom_metrics_reporting_date")) {
        frm.set_df_property("custom_metrics_reporting_date", "hidden", 1);
    }
}

function add_buttons( frm ) {
    if ( !frm.$open_pl_statements ) {
        frm.$open_pl_statements = $("#project-custom_pl div[data-fieldname='custom_open_pl_statement']");
    }

    frm.$open_pl_statements.empty();
    frm.$open_pl_statements.show();

    frappe.ui.form.make_control({
        parent: frm.$open_pl_statements,
        df: {
            label: __("Свод P&L"),
            fieldname: "open_pl_statements",
            fieldtype: "Button",
            btn_size: 'sm',
            click: async function(i){
                frappe.route_options = get_pl_chart_filters(frm);
		        frappe.set_route('query-report', 'Profit and Loss Statement');
            }
        },
        render_input: true,
    });

    if ( !frm.$open_income ) {
        frm.$open_income = $("#project-custom_pl div[data-fieldname='custom_open_income']");
    }

    frm.$open_income.empty();
    frm.$open_income.show();

    frappe.ui.form.make_control({
        parent: frm.$open_income,
        df: {
            label: __("Income"),
            icon: "income",
            fieldname: "open_income",
            fieldtype: "Button",
            btn_size: 'sm',
            click: async function(i){
                frappe.db.get_doc('Account', null, { root_type: "Income", report_type: "Profit and Loss", disabled: false, company: frm.doc.company, parent_account: null })
                .then(doc => {
                    frappe.route_options = get_gl_chart_filters(frm, doc.name );
    		        frappe.set_route('query-report', 'General Ledger');
                });
            }
        },
        render_input: true,
    });

    if ( !frm.$open_expenses ) {
        frm.$open_expenses = $("#project-custom_pl div[data-fieldname='custom_open_expenses']");
    }

    frm.$open_expenses.empty();
    frm.$open_expenses.show();

    frappe.ui.form.make_control({
        parent: frm.$open_expenses,
        df: {
            label: __("Expenses"),
            icon: "expenses",
            fieldname: "open_expenses",
            fieldtype: "Button",
            btn_size: 'sm',
            click: async function(i){
                frappe.db.get_doc('Account', null, { root_type: "Expense", report_type: "Profit and Loss", disabled: false, company: frm.doc.company, parent_account: null })
                .then(doc => {
                    frappe.route_options = get_gl_chart_filters(frm, doc.name );
    		        frappe.set_route('query-report', 'General Ledger');
                });
            }
        },
        render_input: true,
    });
}

function get_gl_chart_filters(frm, account) {
    return {
        "company": frm.doc.company,
        "account": account,
        "from_date": frm.doc.expected_start_date,
        "to_date": frm.doc.expected_end_date,
        "from_fiscal_year":null,
        "to_fiscal_year": null,
        "cost_center":[],
        "task":[],
        "project_role":[],
        "project":[frm.docname],
    };
}

function get_pl_chart_filters(frm) {
    return {
        "company": frm.doc.company,
        "filter_based_on":"Date Range",
        "period_start_date": frm.doc.expected_start_date ? frm.doc.expected_start_date : frappe.datetime.year_start(),
        "period_end_date": frm.doc.expected_end_date ? frm.doc.expected_end_date : frappe.datetime.year_end(),
        "from_fiscal_year":null,
        "to_fiscal_year": null,
        "periodicity":'Monthly',//frm.periodicity.get_value(),
        "cost_center":[],
        "task":[],
        "project_role":[],
        "project":[frm.docname],
        "selected_view":"Report",
        "accumulated_values": 0,//frm.accumulated_values.get_value(),
        "include_default_book_entries":1
    };
}

function add_project_profit_loss_chart(frm) {
    clear_profit_loss_chart( frm );
    // Получаем данные P&L по проекту
    frappe.call({
        method: "frappe.desk.query_report.run",
		type: "GET",
		quiet: true,
		silent: true,
		args: {
			report_name: "Profit and Loss Statement",
			filters: get_pl_chart_filters(frm),
			ignore_prepared_report: false,
			is_tree: true,
			parent_field: "parent_account",
			are_default_filters: false,
		},
        callback: function(r) {
            if (r.message) {
                render_profit_loss_chart(frm, r.message);
            }
        }
    });
}

function clear_profit_loss_chart( frm ) {
    frm.$summary?.empty();
    frm.$chart?.empty();
}

function render_profit_loss_chart(frm, data) {
    if ( data.report_summary ) {
		render_summary(frm, data.report_summary);
	}

	let chart_options = get_chart_options( data );

	if ( chart_options ) {
	//    render_chart( frm, chart_options );
	}
}

function render_summary(frm, data) {
    if ( !frm.$summary ) {
        frm.$summary = $("#project-custom_pl div[data-fieldname='custom_pl_summary']");
        frm.$summary.addClass("report-summary");
    }
    frm.$summary.empty();

	data.forEach((summary) => {
		frappe.utils.build_summary_item(summary).appendTo(frm.$summary);
	});
}

function get_financial_metrics_wrapper(frm) {
    const field = frm?.get_field && frm.get_field("custom_metrics");
    if (!field) {
        console.warn("Project.custom_metrics field is not available");
        return null;
    }

    const fieldWrapper = $(field.wrapper || field.$wrapper);
    if (fieldWrapper.length) {
        const $inner = fieldWrapper.find("div[data-fieldname='custom_metrics']").first();
        frm.$financial_metrics = $inner.length ? $inner : fieldWrapper;
    } else {
        frm.$financial_metrics = $(frm.wrapper).find("div[data-fieldname='custom_metrics']").first();
    }

    if (!frm.$financial_metrics || !frm.$financial_metrics.length) {
        console.warn("Project.custom_metrics render target is not available");
        return null;
    }

    frm.$financial_metrics.show();
    return frm.$financial_metrics;
}

function ensure_financial_metrics_section_open(frm) {
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length) {
        return;
    }

    const $section = $wrapper.closest(".form-section");
    if (!$section.length) {
        return;
    }

    $section.find(".section-head.collapsible").removeClass("collapsed");
    $section.find(".collapse-indicator use").attr("href", "#es-line-up");
    $section.find(".section-body").removeClass("hide").show();
}

function format_financial_metric_value(value, kind) {
    if (!Number.isFinite(value)) {
        return "—";
    }

    if (kind === "ratio") {
        return value.toFixed(3);
    }

    return frappe.format(value, { fieldtype: "Currency" });
}

function render_financial_metrics(frm) {
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length || typeof build_financial_metrics !== "function") {
        return;
    }

    const metricsData = build_financial_metrics(frm);
    ensure_financial_metrics_section_open(frm);
    $wrapper.empty();
    $wrapper.addClass("project-financial-metrics");

    const $section = $('<section class="evm-metrics-section"></section>');
    const $header = $(`
        <div class="evm-metrics-header">
            <div>
                <h3 class="evm-metrics-title">${__("Финансовые метрики")}</h3>
                <div class="evm-metrics-note">${frappe.utils.escape_html(metricsData.note || "")}</div>
            </div>
            <div class="evm-metrics-reporting-date"></div>
        </div>
    `);
    $section.append($header);

    init_financial_metrics_reporting_date(frm);
    frappe.ui.form.make_control({
        parent: $header.find(".evm-metrics-reporting-date"),
        df: {
            fieldtype: "Date",
            fieldname: "financial_metrics_reporting_date",
            label: __("Отчетная дата метрик"),
            change() {
                const nextValue = this.get_value() || frappe.datetime.get_today();
                if (nextValue === frm._financial_metrics_reporting_date) {
                    return;
                }
                frm._financial_metrics_reporting_date = nextValue;
                render_financial_metrics(frm);
            },
        },
        value: frm._financial_metrics_reporting_date,
        render_input: true,
    });

    if (metricsData.warning) {
        $section.append(
            `<div class="evm-metrics-warning">${frappe.utils.escape_html(metricsData.warning)}</div>`
        );
    }

    if (!metricsData.ready) {
        $section.append(
            `<div class="evm-metrics-empty">${frappe.utils.escape_html(metricsData.emptyMessage || __("Нет данных для расчета финансовых метрик."))}</div>`
        );
        $wrapper.append($section);
        return;
    }

    const $tracks = $('<div class="evm-metrics-tracks"></div>');

    metricsData.tracks.forEach((track) => {
        const $track = $(`
            <div class="evm-track-card" data-track="${frappe.utils.escape_html(track.key)}">
                <div class="evm-track-title">${frappe.utils.escape_html(track.label)}</div>
            </div>
        `);

        track.groups.forEach((group) => {
            const $group = $(`
                <div class="evm-metric-group" data-group="${frappe.utils.escape_html(group.key)}">
                    <div class="evm-metric-group-title">${frappe.utils.escape_html(group.label)}</div>
                </div>
            `);

            group.metrics.forEach((metric) => {
                const metricValue = format_financial_metric_value(metric.value, metric.kind);
                const description = frappe.utils.escape_html(metric.description || "");
                const label = frappe.utils.escape_html(metric.label);
                const statusClass = metric.status ? ` is-${metric.status}` : "";
                const helpTitle = description.replace(/"/g, "&quot;");

                $group.append(`
                    <div class="evm-metric-row${statusClass}">
                        <div class="evm-metric-label-wrap">
                            <span class="evm-metric-label">${label}</span>
                            <span class="evm-metric-help" title="${helpTitle}" aria-label="${helpTitle}">i</span>
                        </div>
                        <div class="evm-metric-value">${metricValue}</div>
                    </div>
                `);
            });

            $track.append($group);
        });

        $tracks.append($track);
    });

    $section.append($tracks);
    $wrapper.append($section);
}

globalThis.render_financial_metrics = render_financial_metrics;

function render_chart(frm, options) {
    if ( !frm.$chart ) {
        frm.$chart = $("#project-custom_pl div[data-fieldname='custom_pl_chart']");
        frm.$chart.addClass("chart-wrapper");
    }
	frm.$chart.empty();
	frm.$chart.show();
	frm.chart = new frappe.Chart(frm.$chart[0], options);
}

function get_chart_options(data) {
	let options = data.chart;

	if (!(options && options.data && options.data.labels && options.data.labels.length > 0))
		return;

	if (options.fieldtype) {
		options.tooltipOptions = {
			formatTooltipY: (d) =>
				frappe.format(d, {
					fieldtype: options.fieldtype,
					options: options.options,
				}),
		};
	}
	options.axisOptions = {
		shortenYAxisNumbers: 1,
		numberFormatter: frappe.utils.format_chart_axis_number,
	};
	options.height = 280;
	return options;
}

/* =========================
   === NEW: P&L chart code
   ========================= */

/* === NEW ===
   Собирает данные P&L по периодам из frm.aggregatedBudget
   Возвращает: labels, plan_income, actual_income, plan_expenses, actual_expenses,
               profit_plan, profit_actual, cumulative_profit_plan, cumulative_profit_actual, periods
*/
function build_pl_chart_data(frm) {
    console.time("build_pl_chart_data");
    let aggregated = frm.aggregatedBudget || {};
    let periods = get_budget_display_periods(frm, "month");
    let labels = periods.map(p => `${p.year}-${String(p.month).padStart(2,'0')}`);

    let plan_income = [];
    let actual_income = [];
    let plan_expenses = [];
    let actual_expenses = [];
    let profit_plan = [];
    let profit_actual = [];
    let roots = Object.values( frm.aggregatedBudget ).filter( b => !b.parent_account && !b.task );

    periods.forEach(period => {
        let r = calc_column_total( frm, period, roots, true );
        // Для визуализации расходов делаем значения отрицательными (бар будет под нулём)
        plan_income.push(parseFloat(r.plan_income.toFixed(2)));
        actual_income.push(parseFloat(r.actual_income.toFixed(2)));
        plan_expenses.push(parseFloat((-r.plan_expenses).toFixed(2)));
        actual_expenses.push(parseFloat((-r.actual_expenses).toFixed(2)));
        profit_plan.push(parseFloat(( r.plan_income - r.plan_expenses ).toFixed(2)));
        profit_actual.push(parseFloat( ( r.actual_income - r.actual_expenses ).toFixed(2)));
    });

    // Накопительная прибыль
    let cumulative_profit_plan = [];
    let cumulative_profit_actual = [];
    let cumP = 0, cumA = 0;
    for (let i = 0; i < profit_plan.length; i++) {
        cumP += profit_plan[i];
        cumA += profit_actual[i];
        cumulative_profit_plan.push(parseFloat(cumP.toFixed(2)));
        cumulative_profit_actual.push(parseFloat(cumA.toFixed(2)));
    }

    console.timeEnd("build_pl_chart_data");
    return {
        labels,
        plan_income,
        actual_income,
        plan_expenses,
        actual_expenses,
        profit_plan,
        profit_actual,
        cumulative_profit_plan,
        cumulative_profit_actual,
        periods
    };
}

/* === NEW ===
   Формирует структуру данных, пригодную для frappe.Chart.
   Важно: доходы положительные, расходы — отрицательные (чтобы столбики шли ниже нуля).
   Серии:
     - План доходов (bar)
     - Факт/Прогноз доходов (bar)
     - План расходов (bar, негативные значения)
     - Факт/Прогноз расходов (bar, негативные значения)
     - План прибыль (точки)
     - Факт/Прогноз прибыль (точки)
     - Накопит. приб. план (линия с fill)
     - Накопит. приб. факт/прогноз (линия с fill)
*/
function get_pl_chart_data(frm) {
    let d = build_pl_chart_data(frm);

    let datasets = [];
    let view =  __("факт/прогноз");
    if ( frm.budget_view_options == __("Только прогноз") ) {
        view = __("прогноз");
    } else if ( frm.budget_view_options == __("Только факт") ) {
        view = __("факт");
    }

    // Формируем датасеты в порядке: бары (инком/экспенс), точки (profit), линии (cumulative)
    if ( !frm.bg_hide_plan ) {
        datasets.push( { name: __("Доходы - план"), values: d.plan_income, chartType: 'bar' } );
    }
    datasets.push( { name: __("Доходы") + " - " + view, values: d.actual_income, chartType: 'bar' } );
    if ( !frm.bg_hide_plan ) {
        datasets.push( { name: __("Расходы - план"), values: d.plan_expenses, chartType: 'bar' } );
    }
    datasets.push( { name: __("Расходы") + " - " + view, values: d.actual_expenses, chartType: 'bar' } );

    if ( !frm.bg_hide_plan ) {
        datasets.push( { name: __("Прибыль - план"), values: d.profit_plan, chartType: 'line'} );
    }
    datasets.push( { name: __("Прибыль") + " - " + view, values: d.profit_actual, chartType: 'line' } );

    if ( !frm.bg_hide_plan ) {
        datasets.push( { name: __("Прибыль накопл. - план"), values: d.cumulative_profit_plan, chartType: 'line' } );
    }
    datasets.push( { name: __("Прибыль накопл.") + " - " + view, values: d.cumulative_profit_actual, chartType: 'line' } );

    let yMarkers = null;

    if ( frm.bg_hide_plan ) {
        let profit_plan = d.cumulative_profit_plan[ d.cumulative_profit_plan.length - 1 ];

        if ( profit_plan ) {
            yMarkers = [ { label: __("Плановая прибыль: ") + profit_plan, value: profit_plan, options: { labelPos: "left" } } ];
        }
    }

    return {
        labels: d.labels,
        datasets: datasets,
        yMarkers: yMarkers,
        dataObj: d
    };
}

function get_pl_chart_options(frm, chartData) {
    return {
            //title: __("P&L — План / Факт / Прогноз"),
            data: chartData,
            colors: frm.bg_hide_plan ?
                ['#007a33','#cc3333', '#ff9933','#00509e'] :  //https://piktochart.com/tips/finance-color-palette
                ['#66b3a1', '#007a33','#ff6666', '#cc3333', '#ffcc66', '#ff9933', "#007acc", '#00509e' ],
            type: 'axis-mixed',
            height: 360,
            valuesOverPoints: 0,
            animate: 1,
            truncateLegends: 0,
            showLegend: 0,
            axisOptions: {
                xIsSeries: 0,
                xAxisMode: 'span',
            },
            lineOptions: {
                get hideLine() {
                    return 0;
                },
                hideDots: 0,
                showDots: 1,
                trailingDot: 0,
                dotSize: 3,
                hideDotBorder: 1,
                regionFill: 1,
                spline: 1,
                // area заполнение может потребовать настройки движка; мы помещаем флаг в meta и повторяем здесь для совместимости:
                isArea: 1
            },
            barOptions: {
                stacked: 0,
                spaceRatio: 0.6,
            }
        };
}

const LARGE_DATA_THRESHOLD = 1500;

function render_pl_chart(frm, init=true) {
    if ( Object.values( frm.aggregatedBudget ).length > LARGE_DATA_THRESHOLD ) {
        function bgCallback(deadline) {
               _render_pl_chart( frm, init );
        }

        console.log( "requestIdleCallback( render_pl_chart )" );
        window.requestIdleCallback( ( deadline ) => {
            bgCallback( deadline );
        } );
    } else {
        return _render_pl_chart( frm, init );
    }
}

function _render_pl_chart(frm, init=true) {
    console.time("render_pl_chart");
    try {
        render_financial_metrics(frm);
        // Подготовка данных
        let chartData = get_pl_chart_data(frm);

        if ( frm._pl_chart_instance ) {
            if ( init ) {
                frm._pl_chart_instance.destroy();
            } else {
                frm._pl_chart_instance.update( chartData );
                console.timeEnd("render_pl_chart");
                return;
            }
        }

        // Поле, в котором отрисовываем график
        let wrapper_field = frm.get_field("custom_pl_chart");
        if (!wrapper_field) return;
        let $wrapper = wrapper_field.$wrapper;
        if (!$wrapper || $wrapper.length === 0) return;

        $wrapper.addClass("pl-chart-wrapper");
        if ( !frm.bg_hide_plan ) {
            $wrapper.addClass("pl-chart-with-plan");
        }

        $wrapper.empty();
        let $chartContainer = $('<div class="pl-chart-container"></div>').appendTo($wrapper);

        // Конфигурация frappe.Chart — общий шаблон.
        // Примечание: некоторые опции (area, pointOnly, dashed) передаются через dataset.meta и/или lineOptions.
        const chart_options = get_pl_chart_options( frm, chartData );

        // Создаём новый chart
        try {
            // В зависимости от версии frappe.Chart конструктор может принимать (parent, options) или (selector, config)
            frm._pl_chart_instance = new frappe.Chart($chartContainer[0], chart_options);
        } catch (err) {
            console.error("P&L Chart creation failed:", err);
            $chartContainer.html(`<div style="padding:24px;color:#900;">${__("Ошибка при построении P&L графика")}</div>`);
            console.timeEnd("render_pl_chart");
            return;
        }
    } catch (e) {
        console.error("render_pl_chart error:", e);
    }
    console.timeEnd("render_pl_chart");
}
