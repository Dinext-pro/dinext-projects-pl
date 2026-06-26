// Budget report modules are loaded lazily — only when this report is opened.
// Previously these were in app_include_js which loaded them on every desk page.
const _budget_report_files = [
	"/assets/dinext_common/js/sticky-datatable.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/filters.js?v=20260626_03",
	"/assets/dinext_projects_pl/js/budget_report/datatable_options.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/period_cells.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/column_groups.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/formatter.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/drilldown.js?v=20260626_03",
	"/assets/dinext_projects_pl/js/budget_report/chart.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/export.js?v=20260625_07",
	"/assets/dinext_projects_pl/js/budget_report/styles.js?v=20260626_03",
];

frappe.require(_budget_report_files, function () {
	frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

	var br = dinext_projects_pl.budget_plan_vs_forecast;

	frappe.query_reports["Project Budget Plan vs Forecast"] = {
		filters: br.filters,

		onload: function (report) {
			br.apply_report_styles();
			br.install_sticky_datatable(report);

			br.setup_filter_layout(report);
			br.setup_url_filter_persistence(report);
			br.setup_budget_summary_hooks(report);
			br.setup_period_month_pickers(report);
			br.setup_period_granularity_handler(report);
			br.setup_custom_export(report);
			if (typeof br.install_gl_drilldown_handler === "function") {
				br.install_gl_drilldown_handler();
			}
			if (typeof br.install_plan_forecast_drilldown_handler === "function") {
				br.install_plan_forecast_drilldown_handler();
			}
			br.apply_report_translations(report);
		},

		formatter: br.formatter,
		get_datatable_options: br.get_datatable_options,
		after_datatable_render: br.after_datatable_render,
	};
});
