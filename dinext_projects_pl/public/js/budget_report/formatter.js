frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;
var pc = br.period_cells;

// Atomic cells: one value per column; period grouping is header-only (colspan row).

dinext_projects_pl.budget_plan_vs_forecast.formatter = function (
	value,
	row,
	column,
	data,
	default_formatter
) {
	value = default_formatter(value, row, column, data);

	if (data && data.indent === 0) {
		value = `<b>${value}</b>`;
	}

	if (data && column.fieldname === "account") {
		if (data.is_profit_row) {
			value = `<span data-is-profit-row="1">${value}</span>`;
		} else if (data.is_profitability_row) {
			value = `<span data-is-profitability-row="1">${value}</span>`;
		}
	}

	var fieldname = column.fieldname || "";
	var is_delta = fieldname.startsWith("delta_");
	var is_currency = column.fieldtype === "Currency";

	if (data && is_currency && !data.is_profit_row && !data.is_profitability_row) {
		var raw = flt(data[fieldname]);
		value = pc.format_amount(raw);
		if (raw === 0) {
			value = `<span class="zero">${value}</span>`;
		}
	}

	if (data && is_delta) {
		var delta = flt(data[fieldname]);
		var delta_display = String(delta).replace(/\.0$/, "");
		if (delta === 0) {
			value = `<span class="zero">${delta_display}%</span>`;
		} else {
			value = `${delta_display}%`;
		}
	}

	if (data && data.is_profit_row && is_currency) {
		var profit = flt(data[fieldname]);
		var profit_display = pc.format_amount(profit);
		if (profit > 0) {
			value = `<span style="color: #28a745; font-weight: bold;">${profit_display}</span>`;
		} else if (profit < 0) {
			value = `<span style="color: #dc3545; font-weight: bold;">${profit_display}</span>`;
		} else {
			value = `<span class="zero">${profit_display}</span>`;
		}
	}

	if (data && data.is_profitability_row && is_delta) {
		var profitability = flt(data[fieldname]);
		var profitability_display = String(profitability).replace(/\.0$/, "");
		if (profitability === 0) {
			value = `<span class="zero">${profitability_display}%</span>`;
		} else {
			value = `<span style="font-style: italic;">${profitability_display}%</span>`;
		}
	}

	if (data && data.account && !data.is_profit_row && !data.is_profitability_row) {
		var enable_drill_down = frappe.query_report.get_filter_value("enable_drill_down");
		var drill_amount = data ? flt(data[fieldname]) : 0;

		if (
			enable_drill_down &&
			(fieldname.startsWith("plan_") || fieldname.startsWith("forecast_")) &&
			drill_amount !== 0
		) {
			var parts = fieldname.split("_");
			if (parts.length === 3) {
				value = `<span class="drillable-amount"
							data-account="${data.account}"
							data-year="${parts[1]}"
							data-month="${parts[2]}"
							data-type="${parts[0]}"
							data-amount="${drill_amount}"
							data-is-total="0"
							style="cursor: pointer; text-decoration: underline dotted; color: inherit;">
							${value}
						</span>`;
			}
		} else if (
			enable_drill_down &&
			(fieldname === "total_plan" ||
				fieldname === "total_exp_fct" ||
				fieldname === "total_exp" ||
				fieldname === "total_fct") &&
			drill_amount !== 0
		) {
			var total_type = "plan";
			if (fieldname === "total_exp_fct" || fieldname === "total_exp") {
				total_type = "forecast";
			} else if (fieldname === "total_fct") {
				total_type = "actual";
			}

			value = `<span class="drillable-amount"
						data-account="${data.account}"
						data-year="total"
						data-month="total"
						data-type="${total_type}"
						data-amount="${drill_amount}"
						data-is-total="1"
						style="cursor: pointer; text-decoration: underline wavy; color: inherit; font-weight: 600;">
						${value}
					</span>`;
		}
	}

	return value;
};
