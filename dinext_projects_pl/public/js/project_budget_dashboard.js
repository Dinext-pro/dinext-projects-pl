//https://erp.dinord.ru/app/issue/ISS-2025-01541
// P&L summary + report buttons only when tab «P&L» is visible.
// Not custom_planning: that fieldname is already used by the budget grid lazy mount.
// EVM cards live on tab «Метрики» (project_budget_metrics.js → custom_metrics).
const PL_DASHBOARD_LAZY_FIELD = "custom_pl_summary";

frappe.ui.form.on('Project', {
	refresh: function(frm) {
		if (frm.doc.name && !frm.is_new()) {
			schedule_pl_dashboard_mount(frm);
        }
	},
})

function mount_pl_dashboard(frm) {
	const ready = window.ProjectBudget?.ensureMounted
		? Promise.resolve(window.ProjectBudget.ensureMounted(frm))
		: Promise.resolve();
	return ready.then(() => {
		if (
			window.ProjectBudget?.hasPlAmountAccess &&
			!window.ProjectBudget.hasPlAmountAccess(frm.project_budget)
		) {
			return;
		}
		add_buttons(frm);
		return add_project_profit_loss_chart(frm);
	});
}

function schedule_pl_dashboard_mount(frm) {
	const bind = window.project_workload_assignment?.bindLazyTabMount;
	if (typeof bind !== "function") {
		console.error("[Project P&L Dashboard] bindLazyTabMount missing — refuse eager mount");
		return;
	}
	bind(frm, PL_DASHBOARD_LAZY_FIELD, () => mount_pl_dashboard(frm));
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
            label: __("P&L Summary"),
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

    // 4th slot in the same button row (unused HTML field after Expenses).
    if ( !frm.$open_variance ) {
        frm.$open_variance = $("#project-custom_pl div[data-fieldname='custom_accumulated_values']");
    }

    frm.$open_variance.empty();
    frm.$open_variance.show();

    frappe.ui.form.make_control({
        parent: frm.$open_variance,
        df: {
            label: __("Budget Variance"),
            fieldname: "open_budget_variance",
            fieldtype: "Button",
            btn_size: 'sm',
            click: function(){
                dinext_projects_pl.navigate_to_budget_variance_report?.(frm);
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
    return new Promise((resolve) => {
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
                resolve();
            },
            error: function() {
                resolve();
            },
        });
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
