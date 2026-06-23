frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

frappe.query_reports["Project Budget Plan vs Forecast"] = {
	filters: br.filters,

	onload: function (report) {
		br.apply_report_styles();
		br.install_sticky_datatable(report);

		report.page.add_inner_button(
			br.__("Toggle Plan"),
			function () {
				var show_plan = report.get_filter_value("show_plan");
				report.set_filter_value("show_plan", show_plan ? 0 : 1);
				report.refresh();
			},
			br.__("Controls")
		);

		report.page.add_inner_button(
			br.__("Toggle Drill Down"),
			function () {
				var enable = report.get_filter_value("enable_drill_down");
				report.set_filter_value("enable_drill_down", enable ? 0 : 1);
				frappe.show_alert({
					message: __("Drill Down {0}", [
						enable ? br.__("Disabled") : br.__("Enabled"),
					]),
					indicator: enable ? "red" : "green",
				});
			},
			br.__("Controls")
		);

		br.setup_filter_layout(report);
		br.setup_period_month_pickers(report);
		br.apply_report_translations(report);
	},

	formatter: br.formatter,
	get_datatable_options: br.get_datatable_options,
	after_datatable_render: br.after_datatable_render,
};
