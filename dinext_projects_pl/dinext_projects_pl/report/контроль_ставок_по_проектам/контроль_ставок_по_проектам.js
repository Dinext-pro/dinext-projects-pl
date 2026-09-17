frappe.query_reports["Контроль ставок по проектам"] = {
	onload: function (report) {
		if (report && report.page && report.page.set_title) {
			report.page.set_title(__("Project Rate Control"));
		}
	},
};
