frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.EXPORT_BUDGET_REPORT_METHOD =
	"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.export_xlsx.export_budget_report";

br.setup_custom_export = function (report) {
	if (!report || report._budget_export_patched) {
		return;
	}
	report._budget_export_patched = true;

	var original_export = report.export_report.bind(report);
	report.export_report = function () {
		report.export_dialog = frappe.report_utils.get_export_dialog(
			__(report.report_name),
			[],
			function (options) {
				if (options.file_format === "CSV") {
					original_export();
					report.export_dialog.hide();
					return;
				}

				br.export_budget_report_xlsx(report);
				report.export_dialog.hide();
			}
		);

		report.export_dialog.show();
	};
};

br.export_budget_report_xlsx = function (report) {
	open_url_post(frappe.request.url, {
		cmd: br.EXPORT_BUDGET_REPORT_METHOD,
		filters: JSON.stringify(report.get_filter_values(true)),
	});
};
