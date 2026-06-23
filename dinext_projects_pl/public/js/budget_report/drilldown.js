frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.GET_BUDGET_DETAILS_METHOD =
	"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_budget_details";

br.get_period_filter_range = function (filters) {
	filters = filters || {};

	function parsePeriod(value, yearFallback, monthFallback) {
		if (value) {
			var date = frappe.datetime.str_to_obj(value);
			if (date) {
				return { year: date.getFullYear(), month: date.getMonth() + 1 };
			}
			var monthPeriod = moment(value, ["MM-YYYY", "MM-YY", "M-YYYY", "M-YY"], true);
			if (monthPeriod.isValid()) {
				return { year: monthPeriod.year(), month: monthPeriod.month() + 1 };
			}
		}
		return {
			year: parseInt(yearFallback, 10),
			month: parseInt(monthFallback, 10),
		};
	}

	return {
		from: parsePeriod(filters.from_period, filters.from_year, filters.from_month),
		to: parsePeriod(filters.to_period, filters.to_year, filters.to_month),
	};
};

br.after_datatable_render = function () {
	setTimeout(function () {
		var report = frappe.query_report;
		if (br.setup_filter_layout) {
			br.setup_filter_layout(report);
		}
		if (br.setup_period_month_pickers) {
			br.setup_period_month_pickers(report);
		}

		var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
		if (cg && cg.apply_grouped_headers) {
			cg.apply_grouped_headers();
		}
		if (br.apply_table_header_translations) {
			br.apply_table_header_translations();
		}
		if (br.fix_table_horizontal_layout) {
			br.fix_table_horizontal_layout();
		}
		if (br.render_sticky_summary_footer) {
			br.render_sticky_summary_footer(report);
		}

		$(".dt-row-header .dt-cell--header, .budget-period-group-row .dt-cell").addClass(
			"budget-report-header-cell"
		);

		$(".dt-cell--header").each(function () {
			var $headerCell = $(this);
			var fieldname = $headerCell.data("fieldname");
			if (
				fieldname === "total_plan" ||
				fieldname === "total_exp_fct" ||
				fieldname === "total_exp" ||
				fieldname === "total_fct"
			) {
				$headerCell.find(".dt-cell__content").addClass("total-column-header");
			}
		});

		$(".dt-cell").each(function () {
			var $cell = $(this);
			var fieldname = $cell.data("fieldname");

			if (
				fieldname &&
				(fieldname === "total_plan" ||
					fieldname === "total_exp_fct" ||
					fieldname === "total_exp" ||
					fieldname === "total_fct")
			) {
				$cell.find(".dt-cell__content").addClass("total-column-data");
			}
		});

		$(".drillable-amount")
			.off("click")
			.on("click", function (e) {
				e.stopPropagation();

				var account = $(this).data("account");
				var year = $(this).data("year");
				var month = $(this).data("month");
				var type = $(this).data("type");
				var amount = $(this).data("amount");
				var isTotal = $(this).data("is-total");

				if (isTotal == 1) {
					br.showTotalBudgetDetails(account, type, amount);
				} else {
					br.showBudgetDetails(account, year, month, type, amount);
				}
			});
	}, 100);
};

br.showBudgetDetails = function (account, year, month, type, amount) {
	var amountLabel = type === "plan" ? __("Plan") : __("Forecast");
	var dialog = new frappe.ui.Dialog({
		title: __("Budget Details: {0} - {1}/{2}", [
			amountLabel,
			year,
			month,
		]),
		size: "large",
		fields: [
			{
				fieldname: "html_details",
				fieldtype: "HTML",
				label: __("Details"),
			},
		],
		primary_action_label: __("Export to Excel"),
		primary_action: function () {
			br.exportBudgetDetailsToExcel(dialog);
		},
	});

	dialog.show();
	br.loadBudgetDetails(account, year, month, type, dialog);
};

br.get_report_filter_args = function () {
	var filters = frappe.query_report.get_filter_values();
	return {
		project: filters.project || null,
		project_portfolio: filters.project_portfolio || null,
		cost_center: filters.cost_center || null,
		business_area: filters.business_area || null,
		company: filters.company,
	};
};

br.loadBudgetDetails = function (account, year, month, type, dialog) {
	frappe.call({
		method: br.GET_BUDGET_DETAILS_METHOD,
		args: Object.assign(
			{
				account: account,
				year: year,
				month: month,
				data_type: type,
			},
			br.get_report_filter_args()
		),
		callback: function (response) {
			if (response.message && response.message.length > 0) {
				br.renderBudgetDetails(response.message, dialog);
			} else {
				br.showNoDataMessage(dialog);
			}
		},
		error: function (err) {
			console.error("Error loading budget details:", err);
			frappe.msgprint(__("Error loading budget details: {0}", [err]));
		},
	});
};

br.renderBudgetDetails = function (details, dialog) {
	var html = "";

	if (details.length > 0) {
		var amountType = details[0].amount_type;

		html += '<div style="max-height: 400px; overflow-y: auto;">';
		html += '<table class="budget-detail-table">';
		html += "<thead>";
		html += "<tr>";
		html += "<th>" + __("Project") + "</th>";
		html += "<th>" + __("Account") + "</th>";
		html += "<th>" + __("Year") + "</th>";
		html += '<th style="width: 60px;">' + __("Month") + "</th>";
		html += '<th style="text-align: right;">' + __(amountType) + "</th>";
		html += "</tr>";
		html += "</thead>";
		html += "<tbody>";

		var total = 0;
		details.forEach(function (row) {
			total += row.amount;

			html += "<tr>";
			html += "<td>" + row.project + "</td>";
			html += "<td>" + row.account + "</td>";
			html += "<td>" + row.year + "</td>";
			html += '<td style="text-align: center;">' + row.month + "</td>";
			html += '<td style="text-align: right;">' + br.formatCurrency(row.amount) + "</td>";
			html += "</tr>";
		});

		html +=
			'<tr style="border-top: 2px solid #dee2e6; font-weight: bold; background-color: #f8f9fa;">';
		html += '<td colspan="4" style="text-align: right;">' + __("Total") + ":</td>";
		html += '<td style="text-align: right;">' + br.formatCurrency(total) + "</td>";
		html += "</tr>";
		html += "</tbody>";
		html += "</table>";
		html += "</div>";

		html +=
			'<div style="margin-top: 10px; font-size: 12px; color: #666; text-align: right;">';
		html += __("Total Records") + ": " + details.length;
		html += "</div>";
	} else {
		html =
			'<div class="alert alert-info" style="margin: 10px;">' +
			__("No budget records found for this account and period") +
			"</div>";
	}

	dialog.fields_dict.html_details.set_value(html);
};

br.showNoDataMessage = function (dialog) {
	var html =
		'<div class="alert alert-warning" style="margin: 10px;">' +
		__("No budget data found for this account and period") +
		"</div>";
	dialog.fields_dict.html_details.set_value(html);
};

br.formatCurrency = function (value) {
	if (value === undefined || value === null) return "0";
	var num = flt(value);
	var rounded = Math.round(num);
	return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

br.exportBudgetDetailsToExcel = function (dialog) {
	var $dialog = $(dialog.$wrapper);
	var $table = $dialog.find(".budget-detail-table");

	if ($table.length > 0) {
		br.extractTableToCSV($table[0]);
		return;
	}

	var $htmlContainer = $dialog.find('[data-fieldname="html_details"] .form-control');
	if ($htmlContainer.length > 0) {
		var htmlContent = $htmlContainer.html();
		if (htmlContent) {
			var tempDiv = document.createElement("div");
			tempDiv.innerHTML = htmlContent;
			var table = tempDiv.querySelector(".budget-detail-table");
			if (table) {
				br.extractTableToCSV(table);
				return;
			}
		}
	}

	var htmlField = dialog.fields_dict.html_details;
	if (htmlField && htmlField.$wrapper) {
		var $fieldContainer = htmlField.$wrapper.find(".html-content");
		if ($fieldContainer.length > 0) {
			var htmlContent = $fieldContainer.html();
			if (htmlContent) {
				var tempDiv = document.createElement("div");
				tempDiv.innerHTML = htmlContent;
				var table = tempDiv.querySelector(".budget-detail-table");
				if (table) {
					br.extractTableToCSV(table);
					return;
				}
			}
		}
	}

	frappe.show_alert({
		message: __("Export failed: Could not find table data"),
		indicator: "red",
	});
};

br.extractTableToCSV = function (table) {
	try {
		var headers = [];
		table.querySelectorAll("thead th").forEach(function (th) {
			headers.push(th.innerText.trim());
		});

		var dataRows = [];
		table.querySelectorAll("tbody tr").forEach(function (tr) {
			var rowData = [];
			tr.querySelectorAll("td").forEach(function (td) {
				var text = td.innerText.trim();
				if (text.match(/[\d\s]+/)) {
					text = text.replace(/\s/g, "");
				}
				rowData.push(text);
			});

			if (rowData.length > 0 && rowData.some(function (cell) { return cell.trim() !== ""; })) {
				dataRows.push(rowData);
			}
		});

		var csvRows = [headers.join(";")];
		dataRows.forEach(function (row) {
			var escapedRow = row.map(function (cell) {
				if (cell.includes(";") || cell.includes('"')) {
					return '"' + cell.replace(/"/g, '""') + '"';
				}
				return cell;
			});
			csvRows.push(escapedRow.join(";"));
		});

		var csvContent = csvRows.join("\n");
		var blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
		var link = document.createElement("a");
		var url = URL.createObjectURL(blob);
		link.href = url;
		link.setAttribute("download", "budget_details.csv");
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);

		frappe.show_alert({
			message: __("Exported successfully. Open in Excel."),
			indicator: "green",
		});
	} catch (error) {
		console.error("Export error:", error);
		frappe.show_alert({
			message: __("Export error: {0}", [error.message]),
			indicator: "red",
		});
	}
};

br.showTotalBudgetDetails = function (account, type, amount) {
	var filters = frappe.query_report.get_filter_values();
	var periodRange = br.get_period_filter_range(filters);
	var from_year = periodRange.from.year;
	var to_year = periodRange.to.year;
	var from_month = periodRange.from.month;
	var to_month = periodRange.to.month;
	var filterArgs = br.get_report_filter_args();
	var amountLabel = type === "plan" ? __("Plan") : __("Forecast");

	var dialog = new frappe.ui.Dialog({
		title: __("Total {0} Details: {1}", [amountLabel, account]),
		size: "large",
		fields: [
			{
				fieldname: "html_details",
				fieldtype: "HTML",
				label: __("Details"),
			},
		],
		primary_action_label: __("Export to Excel"),
		primary_action: function () {
			br.exportBudgetDetailsToExcel(dialog);
		},
	});

	dialog.show();

	dialog.fields_dict.html_details.set_value(`
		<div class="alert alert-info" style="margin: 10px;">
			${__("Loading data for period {0}-{1} to {2}-{3}...", [from_year, from_month, to_year, to_month])}
		</div>
	`);

	var allResults = [];
	var monthsToLoad = [];

	for (var year = from_year; year <= to_year; year++) {
		var startMonth = year === from_year ? from_month : 1;
		var endMonth = year === to_year ? to_month : 12;

		for (var month = startMonth; month <= endMonth; month++) {
			monthsToLoad.push({ year: year, month: month });
		}
	}

	function loadMonth(index) {
		if (index >= monthsToLoad.length) {
			br.renderTotalBudgetDetails(allResults, dialog, type);
			return;
		}

		var ym = monthsToLoad[index];

		frappe.call({
			method: br.GET_BUDGET_DETAILS_METHOD,
			args: Object.assign(
				{
					account: account,
					year: ym.year,
					month: ym.month,
					data_type: type,
				},
				filterArgs
			),
			callback: function (response) {
				if (response.message && response.message.length > 0) {
					response.message.forEach(function (row) {
						row.year = ym.year;
						row.month = ym.month;
						allResults.push(row);
					});
				}
				loadMonth(index + 1);
			},
			error: function (err) {
				console.error("Error loading " + ym.year + "-" + ym.month + ":", err);
				loadMonth(index + 1);
			},
		});
	}

	loadMonth(0);
};

br.renderTotalBudgetDetails = function (details, dialog, type) {
	var html = "";

	if (details.length > 0) {
		var amountType = type === "plan" ? __("Plan") : __("Forecast");

		html += '<div style="max-height: 400px; overflow-y: auto;">';
		html += '<table class="budget-detail-table">';
		html += "<thead>";
		html += "<tr>";
		html += "<th>" + __("Project") + "</th>";
		html += "<th>" + __("Account") + "</th>";
		html += "<th>" + __("Year") + "</th>";
		html += '<th style="width: 60px;">' + __("Month") + "</th>";
		html += '<th style="text-align: right;">' + __(amountType) + "</th>";
		html += "</tr>";
		html += "</thead>";
		html += "<tbody>";

		details.sort(function (a, b) {
			if (a.year !== b.year) return a.year - b.year;
			if (a.month !== b.month) return a.month - b.month;
			return (a.project || "").localeCompare(b.project || "");
		});

		var total = 0;
		details.forEach(function (row) {
			total += row.amount;

			html += "<tr>";
			html += "<td>" + row.project + "</td>";
			html += "<td>" + row.account + "</td>";
			html += "<td>" + row.year + "</td>";
			html += '<td style="text-align: center;">' + row.month + "</td>";
			html += '<td style="text-align: right;">' + br.formatCurrency(row.amount) + "</td>";
			html += "</tr>";
		});

		html +=
			'<tr style="border-top: 2px solid #dee2e6; font-weight: bold; background-color: #f8f9fa;">';
		html += '<td colspan="4" style="text-align: right;">' + __("Total") + ":</td>";
		html += '<td style="text-align: right;">' + br.formatCurrency(total) + "</td>";
		html += "</tr>";
		html += "</tbody>";
		html += "</table>";
		html += "</div>";

		html +=
			'<div style="margin-top: 10px; font-size: 12px; color: #666; display: flex; justify-content: space-between;">';
		html +=
			"<span>" +
			__("Period") +
			": " +
			details[0].year +
			"-" +
			details[0].month +
			" to " +
			details[details.length - 1].year +
			"-" +
			details[details.length - 1].month +
			"</span>";
		html += "<span>" + __("Total Records") + ": " + details.length + "</span>";
		html += "</div>";
	} else {
		html =
			'<div class="alert alert-info" style="margin: 10px;">' +
			__("No data found for this period") +
			"</div>";
	}

	dialog.fields_dict.html_details.set_value(html);
};
