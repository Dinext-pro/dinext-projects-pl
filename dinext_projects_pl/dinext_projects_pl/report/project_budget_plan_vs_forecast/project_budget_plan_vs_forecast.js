frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

frappe.query_reports["Project Budget Plan vs Forecast"] = {
	filters: br.filters,

	onload: function (report) {
		br.apply_report_styles();
		br.install_sticky_datatable(report);

		report.page.add_inner_button(
			__("Toggle Plan"),
			function () {
				var show_plan = report.get_filter_value("show_plan");
				report.set_filter_value("show_plan", show_plan ? 0 : 1);
				report.refresh();
			},
			__("Controls")
		);

		report.page.add_inner_button(
			__("Toggle Drill Down"),
			function () {
				var enable = report.get_filter_value("enable_drill_down");
				report.set_filter_value("enable_drill_down", enable ? 0 : 1);
				frappe.show_alert({
					message: __("Drill Down {0}", [enable ? __("Disabled") : __("Enabled")]),
					indicator: enable ? "red" : "green",
				});
			},
			__("Controls")
		);

		br.setup_filter_layout(report);
		br.setup_period_month_pickers(report);
	},

	formatter: br.formatter,
	get_datatable_options: br.get_datatable_options,
	after_datatable_render: br.after_datatable_render,
};
