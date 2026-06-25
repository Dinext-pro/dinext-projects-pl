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

var pc = dinext_projects_pl.budget_plan_vs_forecast.period_cells;

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
	var route_options = {
		company: filters.company,
		account: account,
		from_date: period.from_date,
		to_date: period.to_date,
		from_fiscal_year: null,
		to_fiscal_year: null,
		cost_center: br.normalize_report_filter_array(filters.cost_center),
		project: projects || [],
		task: [],
		project_role: [],
		include_default_book_entries: 1,
		include_dimensions: 1,
	};

	var business_areas = br.normalize_report_filter_array(filters.business_area);
	if (business_areas.length) {
		route_options.business_area = business_areas;
	}

	return route_options;
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
		frappe.route_options = br.build_gl_route_options(account, period, projects);
		frappe.set_route("query-report", "General Ledger");
	});
};

br.install_gl_drilldown_handler = function () {
	if (br._gl_drilldown_handler_installed) {
		return;
	}
	br._gl_drilldown_handler_installed = true;

	$(document).on(
		"dblclick",
		"#page-query-report.budget-plan-vs-forecast-page .budget-gl-drillable",
		function (event) {
			event.preventDefault();
			event.stopPropagation();

			var $target = $(event.currentTarget);
			br.open_general_ledger_drilldown($target.data("account"), $target.data("fieldname"));
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
