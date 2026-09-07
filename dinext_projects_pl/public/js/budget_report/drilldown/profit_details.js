frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;
var pc = dinext_projects_pl.budget_plan_vs_forecast.period_cells;

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
	if (
		drill_meta.drillKind === "gl" &&
		!br.is_gl_drilldown_enabled() &&
		!br.is_actual_cell_gl_drilldown(fieldname)
	) {
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
				br.format_budget_detail_project_cell(row.project) +
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
	br.bind_budget_detail_project_links(dialog);
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
	var monthsToLoad = br.build_period_months_to_load(from_year, from_month, to_year, to_month);

	br.load_period_months_sequentially(
		monthsToLoad,
		function (ym, next) {
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
					next();
				},
				error: function () {
					next();
				},
			});
		},
		function () {
			br.renderTotalProfitDetails(Object.values(aggregated), dialog, type);
		}
	);
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
				br.format_budget_detail_project_cell(row.project) +
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
	br.bind_budget_detail_project_links(dialog);
};
