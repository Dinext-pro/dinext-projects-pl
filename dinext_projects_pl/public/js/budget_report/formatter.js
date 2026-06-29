frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;
var pc = br.period_cells;

dinext_projects_pl.budget_plan_vs_forecast.formatter = function (
	value,
	row,
	column,
	data,
	default_formatter
) {
	var fieldname = column.fieldname || "";
	var is_account_col = fieldname === "account";

	if (is_account_col && data) {
		if (data.is_profit_row) {
			value = default_formatter(value, row, column, data);
			return `<span data-is-profit-row="1">${value}</span>`;
		}
		if (data.is_profitability_row) {
			value = default_formatter(value, row, column, data);
			return `<span data-is-profitability-row="1">${value}</span>`;
		}

		if (data.account) {
			var account_label =
				frappe.utils.get_link_title("Account", data.account) || data.account;
			var is_gl =
				typeof br.is_gl_drilldown_enabled === "function" &&
				br.is_gl_drilldown_enabled();
			var label_class = "budget-account-label";
			if (data.indent === 0) {
				label_class += " budget-account-label--root";
			}
			if (is_gl) {
				label_class += " budget-account-label--gl";
			}
			value =
				'<span class="' +
				label_class +
				'">' +
				frappe.utils.escape_html(account_label) +
				"</span>";
			delete column.link_onclick;
			if (data.indent === 0 && !is_gl) {
				value = `<b>${value}</b>`;
			}
			return value;
		} else {
			value = default_formatter(value, row, column, data);
		}

		delete column.link_onclick;

		if (data.indent === 0) {
			value = `<b>${value}</b>`;
		}
		return value;
	}

	value = default_formatter(value, row, column, data);

	if (data && data.indent === 0) {
		value = `<b>${value}</b>`;
	}

	var is_currency = column.fieldtype === "Currency";

	if (data && is_currency && !data.is_profit_row && !data.is_profitability_row) {
		var raw = flt(data[fieldname]);
		value = pc.format_amount(raw);
		if (raw === 0) {
			value = `<span class="zero">${value}</span>`;
		} else if (fieldname.startsWith("actual_")) {
			value = br.wrap_gl_drilldown_value(value, data, fieldname, raw);
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

	if (data && data.account && !data.is_profit_row && !data.is_profitability_row) {
		var drill_amount = data ? flt(data[fieldname]) : 0;
		var plan_forecast_drill =
			typeof br.is_plan_forecast_drill_enabled === "function" &&
			br.is_plan_forecast_drill_enabled();

		if (
			plan_forecast_drill &&
			(fieldname.startsWith("plan_") || fieldname.startsWith("forecast_")) &&
			drill_amount !== 0
		) {
			var parsed = pc.parse_period_fieldname(fieldname);
			if (parsed) {
				value = br.wrap_plan_forecast_drilldown_value(
					value,
					data,
					fieldname,
					parsed,
					drill_amount
				);
			}
		} else if (
			plan_forecast_drill &&
			(fieldname === "total_plan" ||
				fieldname === "total_exp_fct" ||
				fieldname === "total_exp") &&
			drill_amount !== 0
		) {
			var total_type = fieldname === "total_plan" ? "plan" : "forecast";
			value = br.wrap_plan_forecast_drilldown_value(
				value,
				data,
				fieldname,
				{ type: total_type, year: "total", period_key: "total" },
				drill_amount,
				true
			);
		}
	}

	return value;
};
