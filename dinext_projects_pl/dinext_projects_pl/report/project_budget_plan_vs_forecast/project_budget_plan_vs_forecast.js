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
