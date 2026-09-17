frappe.query_reports["Контроль ставок по T&M проектам_V2"] = {
	onload: function (report) {
		if (report && report.page && report.page.set_title) {
			report.page.set_title(__("T&M Project Rate Control V2"));
		}
	},
};
