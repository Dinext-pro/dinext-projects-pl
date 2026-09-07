frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.install_plan_forecast_drilldown_handler = function () {
	if (br._plan_forecast_drill_handler_installed) {
		return;
	}
	br._plan_forecast_drill_handler_installed = true;

	$(document).off(
		"click.budget_plan_forecast_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-plan-forecast-drillable"
	);
	$(document).off(
		"dblclick.budget_plan_forecast_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-summary-drillable"
	);
	$(document).on(
		"dblclick.budget_plan_forecast_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-plan-forecast-drillable, #page-query-report.budget-plan-vs-forecast-page .budget-summary-drillable:not(.budget-gl-drillable)",
		function (e) {
			e.preventDefault();
			e.stopPropagation();

			var $el = $(this);
			if ($el.attr("data-drill-target") === "profit") {
				br.handle_profit_summary_drill($el);
				return;
			}

			var meta = br.read_plan_forecast_drilldown_meta($el);
			if (!meta.account) {
				frappe.show_alert({
					message: __("Could not resolve account for drill-down"),
					indicator: "orange",
				});
				return;
			}

			if (meta.isTotal) {
				br.showTotalBudgetDetails(meta.account, meta.type, meta.amount);
				return;
			}

			br.showBudgetDetails(meta.account, {
				year: meta.year,
				month: meta.month,
				type: meta.type,
				amount: meta.amount,
				period_key: meta.period_key,
				quarter: meta.quarter,
				period_granularity: meta.period_granularity,
			});
		}
	);
};

br.showBudgetDetails = function (account, periodInfo) {
	periodInfo = periodInfo || {};
	var type = periodInfo.type;
	var year = periodInfo.year;
	var month = periodInfo.month;
	var amountLabel = type === "plan" ? __("Plan") : __("Forecast");
	var periodLabel = periodInfo.period_key || year + "/" + (month || periodInfo.quarter || "");

	var dialog = new frappe.ui.Dialog({
		title: __("Budget Details: {0} - {1}", [amountLabel, periodLabel]),
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
	dialog.$wrapper.addClass("budget-detail-dialog");
	br.loadBudgetDetails(account, periodInfo, dialog);
};

br.decorate_budget_details_dialog = function (dialog) {
	if (dialog && dialog.$wrapper) {
		dialog.$wrapper.addClass("budget-detail-dialog");
	}
};

br.format_budget_detail_project_cell = function (project) {
	if (!project) {
		return "";
	}
	return (
		'<a href="#" class="budget-detail-project-link" data-project="' +
		frappe.utils.escape_html(project) +
		'">' +
		frappe.utils.escape_html(project) +
		"</a>"
	);
};

br.bind_budget_detail_project_links = function (dialog) {
	if (!dialog || !dialog.$wrapper) {
		return;
	}
	if (dialog._budget_project_links_bound) {
		return;
	}
	dialog._budget_project_links_bound = true;
	dialog.$wrapper.on("click.budget-detail-project", ".budget-detail-project-link", function (event) {
		event.preventDefault();
		var project = $(this).attr("data-project");
		if (!project) {
			return;
		}
		if (dialog && typeof dialog.hide === "function") {
			dialog.hide();
		}
		if (typeof dinext_projects_pl !== "undefined" && typeof dinext_projects_pl.navigate_to_project_pl === "function") {
			dinext_projects_pl.navigate_to_project_pl(project);
			return;
		}
		frappe.require("/assets/dinext_projects_pl/js/project_pl_navigation.js", function () {
			if (typeof dinext_projects_pl.navigate_to_project_pl === "function") {
				dinext_projects_pl.navigate_to_project_pl(project);
				return;
			}
			frappe.set_route("Form", "Project", project);
		});
	});
};

br.loadBudgetDetails = function (account, periodInfo, dialog) {
	if (!account) {
		br.showNoDataMessage(dialog);
		return;
	}

	frappe.call({
		method: br.GET_BUDGET_DETAILS_METHOD,
		args: br.build_budget_details_args(account, periodInfo),
		callback: function (response) {
			if (response.exc) {
				frappe.msgprint({
					title: __("Error"),
					indicator: "red",
					message: response.exc,
				});
				br.showNoDataMessage(dialog);
				return;
			}

			var details = response.message;
			if (Array.isArray(details) && details.length > 0) {
				br.renderBudgetDetails(details, dialog);
				return;
			}

			br.showNoDataMessage(dialog);
		},
		error: function (err) {
			console.error("Error loading budget details:", err);
			frappe.msgprint(__("Error loading budget details: {0}", [err]));
			br.showNoDataMessage(dialog);
		},
	});
};

br.renderBudgetDetails = function (details, dialog) {
	br.decorate_budget_details_dialog(dialog);
	var html = "";

	if (details.length > 0) {
		var amountType = details[0].amount_type;
		var has_period_label = Boolean(details[0].period_label);
		var has_month = details.some(function (row) {
			return row.month;
		});

		html += '<div class="budget-detail-table-wrap">';
		html += '<table class="budget-detail-table">';
		html += "<thead><tr>";
		html += '<th class="budget-detail-table__text-left">' + __("Project") + "</th>";
		html += '<th class="budget-detail-table__text-left">' + __("Account") + "</th>";
		if (has_period_label) {
			html += "<th>" + __("Period") + "</th>";
		} else {
			html += "<th>" + __("Year") + "</th>";
			if (has_month) {
				html += '<th style="width: 60px;">' + __("Month") + "</th>";
			}
		}
		html += '<th class="budget-detail-table__amount-head">' + __(amountType) + "</th>";
		html += "</tr></thead><tbody>";

		var total = 0;
		details.forEach(function (row) {
			total += row.amount;

			html += "<tr>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				br.format_budget_detail_project_cell(row.project) +
				"</td>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				frappe.utils.escape_html(row.account || "") +
				"</td>";
			if (has_period_label) {
				html += "<td>" + frappe.utils.escape_html(row.period_label || "") + "</td>";
			} else {
				html += "<td>" + (row.year || "") + "</td>";
				if (has_month) {
					html += "<td>" + (row.month || "") + "</td>";
				}
			}
			html +=
				'<td class="budget-detail-table__amount">' +
				br.formatCurrency(row.amount) +
				"</td>";
			html += "</tr>";
		});

		var colspan = has_period_label ? 3 : has_month ? 4 : 3;
		html += '<tr class="budget-detail-table__total-row">';
		html +=
			'<td colspan="' +
			colspan +
			'" class="budget-detail-table__total-label">' +
			__("Total") +
			":</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total) + "</td>";
		html += "</tr></tbody></table></div>";

		html += '<div class="budget-detail-table__meta">';
		html += __("Total Records") + ": " + details.length;
		html += "</div>";
	} else {
		html =
			'<div class="alert alert-info" style="margin: 10px;">' +
			__("No budget records found for this account and period") +
			"</div>";
	}

	dialog.fields_dict.html_details.set_value(html);
	br.bind_budget_detail_project_links(dialog);
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

br.showTotalBudgetDetails = function (account, type, amount) {
	var filters = frappe.query_report.get_filter_values();
	var periodRange = br.get_period_filter_range(filters);
	var from_year = periodRange.from.year;
	var to_year = periodRange.to.year;
	var from_month = periodRange.from.month;
	var to_month = periodRange.to.month;
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
	br.decorate_budget_details_dialog(dialog);

	dialog.fields_dict.html_details.set_value(`
		<div class="alert alert-info" style="margin: 10px;">
			${__("Loading data for period {0}-{1} to {2}-{3}...", [from_year, from_month, to_year, to_month])}
		</div>
	`);

	var allResults = [];
	var monthsToLoad = br.build_period_months_to_load(from_year, from_month, to_year, to_month);

	br.load_period_months_sequentially(
		monthsToLoad,
		function (ym, next) {
			frappe.call({
				method: br.GET_BUDGET_DETAILS_METHOD,
				args: br.build_budget_details_args(account, {
					year: ym.year,
					month: ym.month,
					type: type,
				}),
				callback: function (response) {
					if (response.message && response.message.length > 0) {
						response.message.forEach(function (row) {
							row.year = ym.year;
							row.month = ym.month;
							allResults.push(row);
						});
					}
					next();
				},
				error: function (err) {
					console.error("Error loading " + ym.year + "-" + ym.month + ":", err);
					next();
				},
			});
		},
		function () {
			br.renderTotalBudgetDetails(allResults, dialog, type);
		}
	);
};

br.renderTotalBudgetDetails = function (details, dialog, type) {
	br.decorate_budget_details_dialog(dialog);
	var html = "";

	if (details.length > 0) {
		var amountType = type === "plan" ? __("Plan") : __("Forecast");

		html += '<div class="budget-detail-table-wrap">';
		html += '<table class="budget-detail-table">';
		html += "<thead><tr>";
		html += '<th class="budget-detail-table__text-left">' + __("Project") + "</th>";
		html += '<th class="budget-detail-table__text-left">' + __("Account") + "</th>";
		html += "<th>" + __("Year") + "</th>";
		html += '<th style="width: 60px;">' + __("Month") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __(amountType) + "</th>";
		html += "</tr></thead><tbody>";

		details.sort(function (a, b) {
			if (a.year !== b.year) return a.year - b.year;
			if (a.month !== b.month) return a.month - b.month;
			return (a.project || "").localeCompare(b.project || "");
		});

		var total = 0;
		details.forEach(function (row) {
			total += row.amount;

			html += "<tr>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				br.format_budget_detail_project_cell(row.project) +
				"</td>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				frappe.utils.escape_html(row.account || "") +
				"</td>";
			html += "<td>" + (row.year || "") + "</td>";
			html += "<td>" + (row.month || "") + "</td>";
			html +=
				'<td class="budget-detail-table__amount">' +
				br.formatCurrency(row.amount) +
				"</td>";
			html += "</tr>";
		});

		html += '<tr class="budget-detail-table__total-row">';
		html += '<td colspan="4" class="budget-detail-table__total-label">' + __("Total") + ":</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total) + "</td>";
		html += "</tr></tbody></table></div>";

		html += '<div class="budget-detail-table__meta budget-detail-table__meta--split">';
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
	br.bind_budget_detail_project_links(dialog);
};

br.wrap_plan_forecast_drilldown_value = function (value, data, fieldname, parsed, raw, isTotal) {
	if (!data || !data.account || flt(raw) === 0) {
		return value;
	}

	var filters = frappe.query_report.get_filter_values();
	var granularity = filters.period_granularity || "month";
	var year = parsed.year || "";
	var month = parsed.month || "";
	var quarter = parsed.quarter || "";
	var period_key = parsed.period_key || fieldname.split("_").slice(1).join("_");

	return (
		'<span class="drillable-amount budget-plan-forecast-drillable"' +
		' data-account="' +
		frappe.utils.escape_html(data.account) +
		'" data-year="' +
		frappe.utils.escape_html(String(year)) +
		'" data-month="' +
		frappe.utils.escape_html(month ? String(month) : "") +
		'" data-quarter="' +
		frappe.utils.escape_html(quarter ? String(quarter) : "") +
		'" data-period-key="' +
		frappe.utils.escape_html(period_key) +
		'" data-period-granularity="' +
		frappe.utils.escape_html(granularity) +
		'" data-amount-type="' +
		frappe.utils.escape_html(parsed.type || "") +
		'" data-amount="' +
		raw +
		'" data-is-total="' +
		(isTotal ? "1" : "0") +
		'">' +
		value +
		"</span>"
	);
};
