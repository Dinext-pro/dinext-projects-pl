frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.GET_BUDGET_DETAILS_METHOD =
	"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_budget_details";

br.GET_PROFIT_DETAILS_METHOD =
	"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_profit_details";

br.read_plan_forecast_drilldown_meta = function ($el) {
	function read_attr(name) {
		var value = $el.attr("data-" + name);
		if (value === undefined || value === null || value === "") {
			return null;
		}
		return value;
	}

	var month = read_attr("month");
	var quarter = read_attr("quarter");

	return {
		account: read_attr("account"),
		year: cint(read_attr("year")),
		month: month ? cint(month) : null,
		quarter: quarter ? cint(quarter) : null,
		period_key: read_attr("period-key"),
		period_granularity: read_attr("period-granularity"),
		type: read_attr("amount-type") || read_attr("type"),
		amount: flt($el.attr("data-amount")),
		isTotal: cint($el.attr("data-is-total") || 0) === 1,
	};
};

br.resolve_drilldown_period_info = function (periodInfo) {
	periodInfo = periodInfo || {};
	var year = cint(periodInfo.year);
	var month =
		periodInfo.month != null && periodInfo.month !== "" ? cint(periodInfo.month) : null;
	var quarter =
		periodInfo.quarter != null && periodInfo.quarter !== ""
			? cint(periodInfo.quarter)
			: null;
	var period_key = periodInfo.period_key || null;

	if (period_key && (!month || !year)) {
		var parts = String(period_key).split("_");
		if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
			year = year || cint(parts[0]);
			month = month || cint(parts[1]);
		} else if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^Q[1-4]$/i.test(parts[1])) {
			year = year || cint(parts[0]);
			quarter = quarter || cint(parts[1].slice(1));
		}
	}

	return {
		year: year,
		month: month,
		quarter: quarter,
		period_key: period_key,
		period_granularity: periodInfo.period_granularity || "month",
		type: periodInfo.type || "plan",
	};
};

br.build_budget_details_args = function (account, periodInfo) {
	periodInfo = br.resolve_drilldown_period_info(periodInfo);
	var report = frappe.query_report;
	var filters = report && report.get_filter_values ? report.get_filter_values() : {};
	var filterArgs = br.get_report_filter_args();

	return Object.assign(
		{
			account: account,
			year: periodInfo.year,
			month: periodInfo.month != null ? periodInfo.month : null,
			quarter: periodInfo.quarter != null ? periodInfo.quarter : null,
			period_key: periodInfo.period_key || null,
			period_granularity:
				periodInfo.period_granularity || filters.period_granularity || "month",
			data_type: periodInfo.type || "plan",
			company:
				filterArgs.company ||
				filters.company ||
				(report && report.get_filter_value && report.get_filter_value("company")),
		},
		filterArgs
	);
};

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
		if (!br.is_budget_report_view(report)) {
			return;
		}

		br.setup_budget_summary_hooks(report);
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
		br.render_budget_summary(report);
		if (br.render_sticky_summary_footer) {
			br.render_sticky_summary_footer(report);
		}
		if (br.render_budget_chart) {
			br.render_budget_chart(report);
		}

		if (cg && cg.apply_period_boundary_classes && report.columns) {
			cg.apply_period_boundary_classes(
				report.columns.filter(function (col) {
					return !col.hidden;
				}),
				report
			);
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

		if (br.bind_account_gl_links) {
			br.bind_account_gl_links();
		}
	}, 100);
};

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
		"#page-query-report.budget-plan-vs-forecast-page .budget-plan-forecast-drillable, #page-query-report.budget-plan-vs-forecast-page .budget-summary-drillable",
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

br.get_report_filter_args = function () {
	var report = frappe.query_report;
	var filters = report && report.get_filter_values ? report.get_filter_values() : {};

	function normalize_filter_value(value) {
		var items = br.normalize_report_filter_array(value);
		return items.length ? items : null;
	}

	return {
		project: normalize_filter_value(filters.project),
		project_portfolio: normalize_filter_value(filters.project_portfolio),
		cost_center: normalize_filter_value(filters.cost_center),
		business_area: normalize_filter_value(filters.business_area),
		company: filters.company || (report && report.get_filter_value("company")),
		apply_cc_allocation: cint(filters.apply_cc_allocation),
	};
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
				frappe.utils.escape_html(row.project || "") +
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
				frappe.utils.escape_html(row.project || "") +
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
};

br.resolve_summary_drill_meta = function (fieldname) {
	var parsed = pc.parse_period_fieldname(fieldname);
	var meta = {
		fieldname: fieldname,
		parsed: parsed,
		isTotal: false,
		type: null,
		drillKind: null,
	};

	if (fieldname === "total_plan") {
		meta.isTotal = true;
		meta.type = "plan";
		meta.drillKind = "profit";
		return meta;
	}
	if (fieldname === "total_exp_fct" || fieldname === "total_exp") {
		meta.isTotal = true;
		meta.type = "forecast";
		meta.drillKind = "profit";
		return meta;
	}
	if (fieldname === "total_fct") {
		meta.isTotal = true;
		meta.drillKind = "gl";
		return meta;
	}

	if (!parsed) {
		return meta;
	}

	if (parsed.type === "plan") {
		meta.type = "plan";
		meta.drillKind = "profit";
	} else if (parsed.type === "forecast") {
		meta.type = "forecast";
		meta.drillKind = "profit";
	} else if (parsed.type === "actual") {
		meta.drillKind = "gl";
	}

	return meta;
};

br.wrap_summary_drilldown_value = function (inner_html, row_type, fieldname, raw) {
	if (!fieldname || fieldname === "account" || flt(raw) === 0) {
		return inner_html;
	}

	var drill_meta = br.resolve_summary_drill_meta(fieldname);
	if (!drill_meta.drillKind) {
		return inner_html;
	}

	if (drill_meta.drillKind === "profit" && !br.is_plan_forecast_drill_enabled()) {
		return inner_html;
	}
	if (drill_meta.drillKind === "gl" && !br.is_gl_drilldown_enabled()) {
		return inner_html;
	}

	var filters = frappe.query_report.get_filter_values();
	var granularity = filters.period_granularity || "month";
	var parsed = drill_meta.parsed || {};
	var year = parsed.year || (drill_meta.isTotal ? "total" : "");
	var month = parsed.month || "";
	var quarter = parsed.quarter || "";
	var period_key =
		parsed.period_key || (drill_meta.isTotal ? "total" : fieldname.split("_").slice(1).join("_"));
	var css_class = "budget-summary-drillable";
	if (drill_meta.drillKind === "gl") {
		css_class += " budget-gl-drillable budget-gl-drillable--active";
	}

	return (
		'<span class="' +
		css_class +
		'" data-drill-target="profit"' +
		' data-drill-kind="' +
		frappe.utils.escape_html(drill_meta.drillKind) +
		'" data-summary-row-type="' +
		frappe.utils.escape_html(row_type) +
		'" data-fieldname="' +
		frappe.utils.escape_html(fieldname) +
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
		frappe.utils.escape_html(drill_meta.type || "") +
		'" data-is-total="' +
		(drill_meta.isTotal ? "1" : "0") +
		'">' +
		inner_html +
		"</span>"
	);
};

br.read_profit_summary_drilldown_meta = function ($el) {
	var meta = br.read_plan_forecast_drilldown_meta($el);
	meta.summaryRowType = $el.attr("data-summary-row-type");
	meta.drillKind = $el.attr("data-drill-kind");
	meta.fieldname = $el.attr("data-fieldname");
	return meta;
};

br.handle_profit_summary_drill = function ($el) {
	var meta = br.read_profit_summary_drilldown_meta($el);
	if (meta.drillKind === "gl") {
		br.open_profit_gl_drilldown(meta.fieldname);
		return;
	}

	if (meta.isTotal) {
		br.showTotalProfitDetails(meta.type);
		return;
	}

	br.showProfitDetails({
		year: meta.year,
		month: meta.month,
		type: meta.type,
		period_key: meta.period_key,
		quarter: meta.quarter,
		period_granularity: meta.period_granularity,
	});
};

br.build_profit_details_args = function (periodInfo) {
	periodInfo = br.resolve_drilldown_period_info(periodInfo || {});
	var report = frappe.query_report;
	var filters = report && report.get_filter_values ? report.get_filter_values() : {};
	var filterArgs = br.get_report_filter_args();

	return Object.assign(
		{
			year: periodInfo.year,
			month: periodInfo.month != null ? periodInfo.month : null,
			quarter: periodInfo.quarter != null ? periodInfo.quarter : null,
			period_key: periodInfo.period_key || null,
			period_granularity:
				periodInfo.period_granularity || filters.period_granularity || "month",
			data_type: periodInfo.type || "plan",
			company:
				filterArgs.company ||
				filters.company ||
				(report && report.get_filter_value && report.get_filter_value("company")),
		},
		filterArgs
	);
};

br.showProfitDetails = function (periodInfo) {
	periodInfo = periodInfo || {};
	var type = periodInfo.type;
	var amountLabel = type === "plan" ? __("Plan") : __("Forecast");
	var periodLabel =
		periodInfo.period_key || periodInfo.year + "/" + (periodInfo.month || periodInfo.quarter || "");

	var dialog = new frappe.ui.Dialog({
		title: __("Gross Profit Details - {0} - {1}", [amountLabel, periodLabel]),
		size: "large",
		fields: [
			{
				fieldname: "html_details",
				fieldtype: "HTML",
				label: __("Details"),
			},
		],
	});

	dialog.show();
	br.decorate_budget_details_dialog(dialog);
	br.loadProfitDetails(periodInfo, dialog);
};

br.loadProfitDetails = function (periodInfo, dialog) {
	dialog.fields_dict.html_details.set_value(
		'<div class="alert alert-info" style="margin: 10px;">' + __("Loading...") + "</div>"
	);

	frappe.call({
		method: br.GET_PROFIT_DETAILS_METHOD,
		args: br.build_profit_details_args(periodInfo),
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
				br.renderProfitDetails(details, dialog);
				return;
			}

			br.showNoDataMessage(dialog);
		},
		error: function (err) {
			console.error("Error loading profit details:", err);
			frappe.msgprint(__("Error loading profit details: {0}", [err]));
			br.showNoDataMessage(dialog);
		},
	});
};

br.renderProfitDetails = function (details, dialog) {
	br.decorate_budget_details_dialog(dialog);
	var html = "";

	if (details.length > 0) {
		var amountType = details[0].amount_type || __("Plan");
		var has_period_label = Boolean(details[0].period_label);

		html += '<div class="budget-detail-table-wrap">';
		html += '<table class="budget-detail-table">';
		html += "<thead><tr>";
		html += '<th class="budget-detail-table__text-left">' + __("Project") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Income") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Expenses") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Gross Profit") + "</th>";
		html +=
			'<th class="budget-detail-table__amount-head">' + __("Profitability (%)") + "</th>";
		html += "</tr></thead><tbody>";

		var total_income = 0;
		var total_expense = 0;
		var total_profit = 0;

		details.forEach(function (row) {
			total_income += flt(row.income);
			total_expense += flt(row.expense);
			total_profit += flt(row.profit);

			html += "<tr>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				frappe.utils.escape_html(row.project || "") +
				"</td>";
			html +=
				'<td class="budget-detail-table__amount">' + br.formatCurrency(row.income) + "</td>";
			html +=
				'<td class="budget-detail-table__amount">' + br.formatCurrency(row.expense) + "</td>";
			html +=
				'<td class="budget-detail-table__amount">' + br.formatCurrency(row.profit) + "</td>";
			html +=
				'<td class="budget-detail-table__amount">' +
				String(flt(row.profitability)).replace(/\.0$/, "") +
				"%</td>";
			html += "</tr>";
		});

		var total_profitability =
			total_income !== 0 ? flt((total_profit / total_income) * 100, 1) : 0;

		html += '<tr class="budget-detail-table__total-row">';
		html += '<td class="budget-detail-table__total-label">' + __("Total") + ":</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_income) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_expense) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_profit) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' +
			String(total_profitability).replace(/\.0$/, "") +
			"%</td>";
		html += "</tr></tbody></table></div>";

		if (has_period_label) {
			html += '<div class="budget-detail-table__meta budget-detail-table__meta--split">';
			html +=
				"<span>" + __("Period") + ": " + frappe.utils.escape_html(details[0].period_label) + "</span>";
			html += "<span>" + __("Type") + ": " + frappe.utils.escape_html(amountType) + "</span>";
			html += "</div>";
		}
	} else {
		html =
			'<div class="alert alert-info" style="margin: 10px;">' +
			__("No data found for this period") +
			"</div>";
	}

	dialog.fields_dict.html_details.set_value(html);
};

br.showTotalProfitDetails = function (type) {
	var filters = frappe.query_report.get_filter_values();
	var periodRange = br.get_period_filter_range(filters);
	var from_year = periodRange.from.year;
	var to_year = periodRange.to.year;
	var from_month = periodRange.from.month;
	var to_month = periodRange.to.month;
	var amountLabel = type === "plan" ? __("Plan") : __("Forecast");

	var dialog = new frappe.ui.Dialog({
		title: __("Total Gross Profit Details - {0}", [amountLabel]),
		size: "large",
		fields: [
			{
				fieldname: "html_details",
				fieldtype: "HTML",
				label: __("Details"),
			},
		],
	});

	dialog.show();
	br.decorate_budget_details_dialog(dialog);
	dialog.fields_dict.html_details.set_value(`
		<div class="alert alert-info" style="margin: 10px;">
			${__("Loading data for period {0}-{1} to {2}-{3}...", [from_year, from_month, to_year, to_month])}
		</div>
	`);

	var aggregated = {};
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
			br.renderTotalProfitDetails(Object.values(aggregated), dialog, type);
			return;
		}

		var ym = monthsToLoad[index];

		frappe.call({
			method: br.GET_PROFIT_DETAILS_METHOD,
			args: br.build_profit_details_args({
				year: ym.year,
				month: ym.month,
				type: type,
			}),
			callback: function (response) {
				if (response.message && response.message.length > 0) {
					response.message.forEach(function (row) {
						if (!aggregated[row.project]) {
							aggregated[row.project] = {
								project: row.project,
								income: 0,
								expense: 0,
								profit: 0,
								amount_type: row.amount_type,
							};
						}
						aggregated[row.project].income += flt(row.income);
						aggregated[row.project].expense += flt(row.expense);
						aggregated[row.project].profit += flt(row.profit);
					});
				}
				loadMonth(index + 1);
			},
			error: function () {
				loadMonth(index + 1);
			},
		});
	}

	loadMonth(0);
};

br.renderTotalProfitDetails = function (details, dialog, type) {
	br.decorate_budget_details_dialog(dialog);
	var html = "";

	if (details.length > 0) {
		var amountType = type === "plan" ? __("Plan") : __("Forecast");

		html += '<div class="budget-detail-table-wrap">';
		html += '<table class="budget-detail-table">';
		html += "<thead><tr>";
		html += '<th class="budget-detail-table__text-left">' + __("Project") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Income") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Expenses") + "</th>";
		html += '<th class="budget-detail-table__amount-head">' + __("Gross Profit") + "</th>";
		html +=
			'<th class="budget-detail-table__amount-head">' + __("Profitability (%)") + "</th>";
		html += "</tr></thead><tbody>";

		var total_income = 0;
		var total_expense = 0;
		var total_profit = 0;

		details.sort(function (a, b) {
			return (a.project || "").localeCompare(b.project || "");
		});

		details.forEach(function (row) {
			var income = flt(row.income);
			var expense = flt(row.expense);
			var profit = flt(row.profit);
			var profitability = income ? flt((profit / income) * 100, 1) : 0;
			total_income += income;
			total_expense += expense;
			total_profit += profit;

			html += "<tr>";
			html +=
				'<td class="budget-detail-table__text-left">' +
				frappe.utils.escape_html(row.project || "") +
				"</td>";
			html += '<td class="budget-detail-table__amount">' + br.formatCurrency(income) + "</td>";
			html += '<td class="budget-detail-table__amount">' + br.formatCurrency(expense) + "</td>";
			html += '<td class="budget-detail-table__amount">' + br.formatCurrency(profit) + "</td>";
			html +=
				'<td class="budget-detail-table__amount">' +
				String(profitability).replace(/\.0$/, "") +
				"%</td>";
			html += "</tr>";
		});

		var total_profitability =
			total_income !== 0 ? flt((total_profit / total_income) * 100, 1) : 0;

		html += '<tr class="budget-detail-table__total-row">';
		html += '<td class="budget-detail-table__total-label">' + __("Total") + ":</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_income) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_expense) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' + br.formatCurrency(total_profit) + "</td>";
		html +=
			'<td class="budget-detail-table__amount">' +
			String(total_profitability).replace(/\.0$/, "") +
			"%</td>";
		html += "</tr></tbody></table></div>";

		html += '<div class="budget-detail-table__meta budget-detail-table__meta--split">';
		html += "<span>" + __("Type") + ": " + amountType + "</span>";
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

br.open_profit_gl_drilldown = function (fieldname) {
	if (!fieldname || !br.is_gl_drilldown_enabled()) {
		frappe.show_alert({
			message: br.get_gl_drilldown_disabled_message(),
			indicator: "orange",
		});
		return;
	}

	var period = br.parse_gl_drilldown_period(fieldname);
	if (!period) {
		return;
	}

	var report = frappe.query_report;
	var summary = report && report._budget_summary_rows;
	var accounts = []
		.concat(summary && summary.root_income_accounts ? summary.root_income_accounts : [])
		.concat(summary && summary.root_expense_accounts ? summary.root_expense_accounts : []);

	br.resolve_gl_filter_projects().then(function (projects) {
		br.navigate_to_general_ledger(br.build_gl_route_options(accounts, period, projects));
	});
};

var pc = dinext_projects_pl.budget_plan_vs_forecast.period_cells;

br.is_plan_forecast_drill_enabled = function () {
	var report = frappe.query_report;
	if (!report || !report.get_filter_value) {
		return false;
	}
	var projects = br.normalize_report_filter_array(report.get_filter_value("project"));
	if (projects.length === 1) {
		return false;
	}
	return true;
};

br.get_report_filter_period = function () {
	var filters = frappe.query_report.get_filter_values();
	return {
		from_date: filters.from_period || frappe.datetime.year_start(),
		to_date: filters.to_period || frappe.datetime.year_end(),
	};
};

br.get_account_column_dom_index = function () {
	var report = frappe.query_report;
	if (!report || !Array.isArray(report.columns)) {
		return 0;
	}

	var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
	var dom_offset =
		cg && typeof cg.get_column_dom_offset === "function" ? cg.get_column_dom_offset() : 0;

	for (var i = 0; i < report.columns.length; i++) {
		var col = report.columns[i];
		if ((col.fieldname || col.id) === "account") {
			return i + dom_offset;
		}
	}

	return dom_offset;
};

br.get_datatable_row_data = function ($row) {
	var report = frappe.query_report;
	if (!report || !Array.isArray(report.data) || !$row || !$row.length) {
		return null;
	}

	var row_index = cint($row.attr("data-row-index"));
	if (row_index >= 0 && report.data[row_index]) {
		return report.data[row_index];
	}

	var account_col = br.get_account_column_dom_index();
	var $account_cell = $row.find(".dt-cell--col-" + account_col).first();
	var class_name = $account_cell.attr("class") || "";
	var match = class_name.match(new RegExp("dt-cell--" + account_col + "-(\\d+)"));
	if (match) {
		row_index = cint(match[1]);
		return report.data[row_index] || null;
	}

	return null;
};

br.decorate_account_gl_cells = function () {
	var $page = $("#page-query-report.budget-plan-vs-forecast-page");
	if (!$page.length) {
		return;
	}

	var enabled = br.is_gl_drilldown_enabled();
	$page.toggleClass("budget-gl-drilldown-mode", enabled);

	var account_col = br.get_account_column_dom_index();
	var cell_selector = ".dt-cell--col-" + account_col;

	$page.find(cell_selector).each(function () {
		var $cell = $(this);
		$cell.removeClass("budget-account-cell--gl").removeAttr("data-account");

		if (
			!enabled ||
			$cell.closest(".dt-row-header, .dt-row-totalRow, .budget-period-group-row").length
		) {
			return;
		}

		var row_data = br.get_datatable_row_data($cell.closest(".dt-row"));
		if (
			!row_data ||
			!row_data.account ||
			row_data.is_profit_row ||
			row_data.is_profitability_row
		) {
			return;
		}

		$cell
			.addClass("budget-account-cell--gl")
			.attr("data-account", row_data.account);
	});
};

br.open_account_gl_drilldown = function (account) {
	if (!account) {
		return;
	}

	if (!br.is_gl_drilldown_enabled()) {
		frappe.show_alert({
			message: br.get_gl_drilldown_disabled_message(),
			indicator: "orange",
		});
		return;
	}

	var period = br.get_report_filter_period();
	br.resolve_gl_filter_projects().then(function (projects) {
		br.navigate_to_general_ledger(br.build_gl_route_options(account, period, projects));
	});
};

br.bind_account_gl_links = function () {
	br.decorate_account_gl_cells();
};

br.handle_account_gl_cell_click = function (event) {
	if ($(event.target).closest(".dt-tree-node__toggle").length) {
		return;
	}

	var $cell = $(event.currentTarget);
	var row_data = br.get_datatable_row_data($cell.closest(".dt-row"));
	if (
		!row_data ||
		!row_data.account ||
		row_data.is_profit_row ||
		row_data.is_profitability_row
	) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	br.open_account_gl_drilldown(row_data.account);
};

br.is_gl_drilldown_enabled = function () {
	var report = frappe.query_report;
	if (!report || !report.get_filter_value) {
		return false;
	}
	return (
		report.get_filter_value("view_type") === "actual_only" &&
		!cint(report.get_filter_value("show_plan"))
	);
};

br.normalize_report_filter_array = function (value) {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.filter(Boolean);
	}
	return [value];
};

br.get_gl_drilldown_disabled_message = function () {
	return br.__("To view GL entries, select Fact Only and disable Show Plan.");
};

br.parse_gl_drilldown_period = function (fieldname) {
	var parsed = pc.parse_period_fieldname(fieldname);
	if (!parsed || parsed.type !== "actual") {
		return null;
	}

	var filters = frappe.query_report.get_filter_values();

	if (parsed.month) {
		var month_date = moment({ year: parsed.year, month: parsed.month - 1, day: 1 });
		return {
			from_date: month_date.format(frappe.defaultDateFormat),
			to_date: month_date.clone().endOf("month").format(frappe.defaultDateFormat),
		};
	}

	if (parsed.quarter) {
		var quarter_start_month = (parsed.quarter - 1) * 3;
		var quarter_start = moment({ year: parsed.year, month: quarter_start_month, day: 1 });
		return {
			from_date: quarter_start.format(frappe.defaultDateFormat),
			to_date: quarter_start
				.clone()
				.add(2, "months")
				.endOf("month")
				.format(frappe.defaultDateFormat),
		};
	}

	var year_start = moment({ year: parsed.year, month: 0, day: 1 });
	var year_end = moment({ year: parsed.year, month: 11, day: 1 }).endOf("month");
	var filter_from = filters.from_period ? moment(filters.from_period) : year_start;
	var filter_to = filters.to_period ? moment(filters.to_period) : year_end;

	if (filter_from.isValid() && filter_from.year() === parsed.year && filter_from.isAfter(year_start)) {
		year_start = filter_from.clone().startOf("month");
	}
	if (filter_to.isValid() && filter_to.year() === parsed.year && filter_to.isBefore(year_end)) {
		year_end = filter_to.clone().endOf("month");
	}

	return {
		from_date: year_start.format(frappe.defaultDateFormat),
		to_date: year_end.format(frappe.defaultDateFormat),
	};
};

br.resolve_gl_filter_projects = function () {
	var filters = frappe.query_report.get_filter_values();
	var projects = br.normalize_report_filter_array(filters.project);
	if (projects.length) {
		return Promise.resolve(projects);
	}

	var portfolios = br.normalize_report_filter_array(filters.project_portfolio);
	if (!portfolios.length) {
		return Promise.resolve([]);
	}

	return frappe.db
		.get_list("Project", {
			filters: { custom_project_portfolio: ["in", portfolios] },
			fields: ["name"],
			limit: 0,
		})
		.then(function (rows) {
			return (rows || []).map(function (row) {
				return row.name;
			});
		});
};

br.build_gl_route_options = function (account, period, projects) {
	var filters = frappe.query_report.get_filter_values();
	var account_value = account;
	if (account && !Array.isArray(account)) {
		account_value = [account];
	}

	var route_options = {
		company: filters.company,
		account: account_value,
		from_date: period.from_date,
		to_date: period.to_date,
		cost_center: br.normalize_report_filter_array(filters.cost_center),
		project: projects || [],
		include_default_book_entries: 1,
		include_dimensions: 1,
	};

	var business_areas = br.normalize_report_filter_array(filters.business_area);
	if (business_areas.length) {
		route_options.business_area = business_areas;
	}

	return route_options;
};

br.navigate_to_general_ledger = function (route_options) {
	if (typeof br.cleanup_budget_report_page_layout === "function") {
		br.cleanup_budget_report_page_layout();
	}
	frappe.route_options = route_options;
	frappe.set_route("query-report", "General Ledger");
};

br.open_general_ledger_drilldown = function (account, fieldname) {
	if (!account || !fieldname) {
		return;
	}

	if (!br.is_gl_drilldown_enabled()) {
		frappe.show_alert({
			message: br.get_gl_drilldown_disabled_message(),
			indicator: "orange",
		});
		return;
	}

	var period = br.parse_gl_drilldown_period(fieldname);
	if (!period) {
		return;
	}

	br.resolve_gl_filter_projects().then(function (projects) {
		br.navigate_to_general_ledger(br.build_gl_route_options(account, period, projects));
	});
};

br.install_gl_drilldown_handler = function () {
	$(document).off(
		"dblclick.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-gl-drillable"
	);
	$(document).off(
		"dblclick.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page.budget-gl-drilldown-mode .dt-scrollable .dt-row:not(.dt-row-header):not(.dt-row-totalRow) .dt-cell--col-0"
	);
	$(document).off(
		"click.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page.budget-gl-drilldown-mode .dt-scrollable .dt-row:not(.dt-row-header):not(.dt-row-totalRow) .dt-cell--col-0"
	);

	$(document).on(
		"dblclick.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-gl-drillable",
		function (event) {
			event.preventDefault();
			event.stopPropagation();

			var $target = $(event.currentTarget);
			if ($target.attr("data-drill-target") === "profit") {
				br.handle_profit_summary_drill($target);
				return;
			}

			br.open_general_ledger_drilldown($target.data("account"), $target.data("fieldname"));
		}
	);

	$(document).on(
		"dblclick.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page.budget-gl-drilldown-mode .dt-scrollable .dt-row:not(.dt-row-header):not(.dt-row-totalRow) .dt-cell--col-0",
		function (event) {
			br.handle_account_gl_cell_click(event);
		}
	);
};

br.wrap_gl_drilldown_value = function (value, data, fieldname, raw) {
	if (!fieldname || !fieldname.startsWith("actual_") || !data || !data.account) {
		return value;
	}
	if (data.is_profit_row || data.is_profitability_row || flt(raw) === 0) {
		return value;
	}

	var active_class = br.is_gl_drilldown_enabled() ? " budget-gl-drillable--active" : "";

	return (
		'<span class="budget-gl-drillable' +
		active_class +
		'" data-account="' +
		frappe.utils.escape_html(data.account) +
		'" data-fieldname="' +
		frappe.utils.escape_html(fieldname) +
		'">' +
		value +
		"</span>"
	);
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

br.get_report_company_currency = function (company) {
	if (company) {
		var cached = frappe.model.get_doc("Company", company);
		if (cached && cached.default_currency) {
			return cached.default_currency;
		}
	}
	return (frappe.boot.sysdefaults && frappe.boot.sysdefaults.currency) || "RUB";
};

br.ensure_budget_pl_summary = function (report) {
	var $page = $("#page-query-report");
	if (!$page.length && report && report.page && report.page.wrapper) {
		$page = report.page.wrapper.closest("#page-query-report");
	}
	if (!$page.length) {
		return null;
	}

	if (report.$budget_pl_summary && report.$budget_pl_summary.length) {
		return report.$budget_pl_summary;
	}

	var $existing = $page.find("> .layout-main-section > .budget-pl-summary, .layout-main-section > .budget-pl-summary").first();
	if (!$existing.length) {
		$existing = $page.find(".budget-pl-summary").first();
	}
	if ($existing.length) {
		report.$budget_pl_summary = $existing;
		return $existing;
	}

	var $summary = $('<div class="report-summary budget-pl-summary"></div>');
	var $filters = $page.find(".page-form.budget-report-filters-form").first();
	if (!$filters.length) {
		$filters = $page.find(".page-form").first();
	}
	var $report = (report && report.$report) || $page.find(".report-wrapper").first();

	if ($filters.length) {
		$summary.insertAfter($filters);
	} else if ($report.length) {
		$summary.insertBefore($report);
	} else {
		var $main = $page.find(".layout-main-section").first();
		if (!$main.length && report && report.page) {
			$main = report.page.main || report.page.wrapper;
		}
		$summary.appendTo($main);
	}

	report.$budget_pl_summary = $summary;
	return $summary;
};

br.get_budget_report_columns = function (report) {
	if (report && report.raw_data && report.raw_data.columns) {
		return report.raw_data.columns;
	}
	return (report && report.columns) || [];
};

br.build_budget_summary_totals = function (report) {
	if (!report || !report.data || !report.data.length) {
		return null;
	}

	var period_groups = br.get_budget_period_groups(br.get_budget_report_columns(report));
	var income_roots = br.get_budget_root_rows(report.data).filter(function (row) {
		return row.root_type === "Income";
	});
	var expense_roots = br.get_budget_root_rows(report.data).filter(function (row) {
		return row.root_type === "Expense";
	});

	var income_display = 0;
	var expense_display = 0;

	period_groups.forEach(function (group) {
		income_display += br.sum_row_fields(income_roots, group.display);
		expense_display += br.sum_row_fields(expense_roots, group.display);
	});

	return {
		income: income_display,
		expense: Math.abs(expense_display),
		profit: income_display - expense_display,
	};
};

br.build_pl_report_summary = function (totals, currency) {
	return [
		{
			value: totals.income,
			label: br.__("Total Income"),
			datatype: "Currency",
			currency: currency,
		},
		{ type: "separator", value: "-" },
		{
			value: totals.expense,
			label: br.__("Total Expense"),
			datatype: "Currency",
			currency: currency,
		},
		{ type: "separator", value: "=", color: "blue" },
		{
			value: totals.profit,
			indicator: totals.profit > 0 ? "Green" : "Red",
			label: br.__("Net Profit"),
			datatype: "Currency",
			currency: currency,
		},
	];
};

br.render_budget_summary = function (report) {
	report = report || frappe.query_report;
	if (!report) {
		return;
	}

	var $summary = br.ensure_budget_pl_summary(report);
	if (!$summary) {
		return;
	}

	var totals = br.build_budget_summary_totals(report);
	$summary.empty();

	if (!totals) {
		$summary.hide();
		return;
	}

	var filters = report.get_filter_values ? report.get_filter_values() : {};
	var currency = br.get_report_company_currency(filters.company);

	br.build_pl_report_summary(totals, currency).forEach(function (summary) {
		frappe.utils.build_summary_item(summary).appendTo($summary);
	});

	$summary.css("display", "flex").show();
};

br.setup_budget_summary_hooks = function (report) {
	if (!report || report._budget_summary_hooks_installed) {
		return;
	}
	report._budget_summary_hooks_installed = true;

	var original_refresh = report.refresh.bind(report);
	report.refresh = function (have_filters_changed) {
		return original_refresh(have_filters_changed).then(function (result) {
			br.render_budget_summary(report);
			return result;
		});
	};
};
