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

br.normalize_report_filter_array = function (value) {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.filter(Boolean);
	}
	return [value];
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

br.build_period_months_to_load = function (from_year, from_month, to_year, to_month) {
	var monthsToLoad = [];
	for (var year = from_year; year <= to_year; year++) {
		var startMonth = year === from_year ? from_month : 1;
		var endMonth = year === to_year ? to_month : 12;
		for (var month = startMonth; month <= endMonth; month++) {
			monthsToLoad.push({ year: year, month: month });
		}
	}
	return monthsToLoad;
};

br.load_period_months_sequentially = function (monthsToLoad, fetchMonth, onComplete) {
	function loadMonth(index) {
		if (index >= monthsToLoad.length) {
			onComplete();
			return;
		}
		fetchMonth(monthsToLoad[index], function () {
			loadMonth(index + 1);
		});
	}
	loadMonth(0);
};
