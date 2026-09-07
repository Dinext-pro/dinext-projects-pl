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
	report._budget_export_original = original_export;
	report.export_report = function () {
		if (typeof br.is_budget_report_view === "function" && !br.is_budget_report_view(report)) {
			original_export();
			return;
		}

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

br.restore_custom_export = function (report) {
	report = report || frappe.query_report;
	if (!report || !report._budget_export_patched) {
		return;
	}
	if (typeof report._budget_export_original === "function") {
		report.export_report = report._budget_export_original;
	}
	report._budget_export_patched = false;
	report._budget_export_original = null;
};

br.export_budget_report_xlsx = function (report) {
	open_url_post(frappe.request.url, {
		cmd: br.EXPORT_BUDGET_REPORT_METHOD,
		filters: JSON.stringify(report.get_filter_values(true)),
	});
};
