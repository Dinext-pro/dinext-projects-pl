// Budget report modules are loaded lazily — only when this report is opened.
// Previously these were in app_include_js which loaded them on every desk page.
const REPORT_NAME = "Project Budget Plan vs Forecast";

const _budget_report_files = [
	"/assets/dinext_common/js/sticky-datatable.js",
	"/assets/dinext_projects_pl/js/budget_report/filters.js",
	"/assets/dinext_projects_pl/js/budget_report/presentation.js",
	"/assets/dinext_projects_pl/js/budget_report/datatable_options.js",
	"/assets/dinext_projects_pl/js/budget_report/period_cells.js",
	"/assets/dinext_projects_pl/js/budget_report/column_groups.js",
	"/assets/dinext_projects_pl/js/budget_report/formatter.js",
	"/assets/dinext_projects_pl/js/budget_report/drilldown.js",
	"/assets/dinext_projects_pl/js/budget_report/chart.js",
	"/assets/dinext_projects_pl/js/budget_report/export.js",
	"/assets/dinext_projects_pl/js/budget_report/styles.js",
];

frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

function ensure_budget_report_assets(callback) {
	var br = dinext_projects_pl.budget_plan_vs_forecast;
	if (br._assets_loaded) {
		callback();
		return;
	}
	if (br._assets_loading) {
		(br._assets_callbacks || (br._assets_callbacks = [])).push(callback);
		return;
	}
	br._assets_loading = true;
	br._assets_callbacks = [callback];
	frappe.require(_budget_report_files, function () {
		br._assets_loaded = true;
		bind_budget_report_module_settings();
		var callbacks = br._assets_callbacks || [];
		br._assets_callbacks = [];
		br._assets_loading = false;
		callbacks.forEach(function (cb) {
			cb();
		});
	});
}

function bind_budget_report_module_settings() {
	var br = dinext_projects_pl.budget_plan_vs_forecast;
	var settings = frappe.query_reports[REPORT_NAME];
	if (!settings) {
		return;
	}
	settings.filters = br.filters;
	settings.formatter = br.formatter;
	settings.get_datatable_options = br.get_datatable_options;
	settings.after_datatable_render = br.after_datatable_render;
}

function init_budget_report(report) {
	var br = dinext_projects_pl.budget_plan_vs_forecast;
	bind_budget_report_module_settings();

	if (report && report.report_settings) {
		report.report_settings.filters = br.filters;
	}
	if (report && typeof report.setup_filters === "function") {
		report.setup_filters();
	}

	br.apply_report_styles();
	br.install_sticky_datatable(report);
	br.setup_filter_layout(report);
	br.setup_url_filter_persistence(report);
	br.setup_budget_summary_hooks(report);
	br.setup_period_month_pickers(report);
	br.setup_period_granularity_handler(report);
	br.setup_custom_export(report);
	if (typeof br.disable_budget_report_toolbar_actions === "function") {
		br.disable_budget_report_toolbar_actions(report);
	}
	if (typeof br.install_budget_presentation_hooks === "function") {
		br.install_budget_presentation_hooks(report);
	}
	if (typeof br.install_gl_drilldown_handler === "function") {
		br.install_gl_drilldown_handler();
	}
	if (typeof br.install_plan_forecast_drilldown_handler === "function") {
		br.install_plan_forecast_drilldown_handler();
	}
	br.apply_report_translations(report);

	if (report && typeof report.refresh === "function") {
		report.refresh(true);
	}
}

function budget_report_onload(report) {
	ensure_budget_report_assets(function () {
		init_budget_report(report);
	});
}

// Register synchronously: Frappe resolves report settings right after eval,
// before async frappe.require() completes (see query_report.get_report_settings).
frappe.query_reports[REPORT_NAME] = {
	filters: [],

	onload: budget_report_onload,

	formatter: function (value, row, column, data, default_formatter, report) {
		var br = dinext_projects_pl.budget_plan_vs_forecast;
		if (typeof br.formatter === "function") {
			return br.formatter(value, row, column, data, default_formatter, report);
		}
		return default_formatter(value, row, column, data);
	},

	get_datatable_options: function (options) {
		var br = dinext_projects_pl.budget_plan_vs_forecast;
		if (typeof br.get_datatable_options === "function") {
			return br.get_datatable_options(options);
		}
		return options;
	},

	after_datatable_render: function () {
		var br = dinext_projects_pl.budget_plan_vs_forecast;
		if (typeof br.after_datatable_render === "function") {
			return br.after_datatable_render();
		}
	},
};

ensure_budget_report_assets(function () {});
