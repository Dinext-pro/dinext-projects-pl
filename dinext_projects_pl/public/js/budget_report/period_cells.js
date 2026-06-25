frappe.provide("dinext_projects_pl.budget_plan_vs_forecast.period_cells");

var pc = dinext_projects_pl.budget_plan_vs_forecast.period_cells;

pc.is_past_period = function (year, month) {
	var today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	var y = cint(year);
	var m = cint(month);
	return y < today.getFullYear() || (y === today.getFullYear() && m < today.getMonth() + 1);
};

pc.format_amount = function (value) {
	if (value === undefined || value === null || value === "") {
		return "0";
	}
	var num = flt(value);
	if (isNaN(num)) {
		return value;
	}
	var rounded = Math.round(num);
	return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

pc.parse_period_fieldname = function (fieldname) {
	var match = /^(plan|actual|forecast)_(\d{4})(?:_(\d{2}|Q[1-4]))?$/.exec(fieldname || "");
	if (!match) {
		return null;
	}
	return {
		type: match[1],
		year: cint(match[2]),
		month: match[3] && /^\d+$/.test(match[3]) ? cint(match[3]) : null,
		quarter: match[3] && match[3].indexOf("Q") === 0 ? cint(match[3].slice(1)) : null,
		period_key: match[2] + (match[3] ? "_" + match[3] : ""),
	};
};

pc.render_period_header = function (year, month, options) {
	options = options || {};
	var show_plan = options.show_plan !== false;
	var is_past = pc.is_past_period(year, month);
	var sublabel = is_past ? br.__("Fact") : br.__("Forecast");
	var month_label = month < 10 ? "0" + month : String(month);

	var html =
		'<div style="text-align:center;">' +
		year +
		" " +
		month_label +
		"<br/>" +
		'<div class="budget-group-header">';

	if (show_plan) {
		html += "<span>" + br.__("Plan") + "</span>";
	}
	html += "<span>" + sublabel + "</span>";
	html += "</div></div>";

	return html;
};

pc.render_period_cell = function (plan, actual, forecast, options) {
	options = options || {};
	var year = options.year;
	var month = options.month;
	var is_past =
		options.is_past != null ? options.is_past : pc.is_past_period(year, month);
	var show_plan = options.show_plan !== false;

	plan = flt(plan);
	actual = flt(actual);
	forecast = flt(forecast);
	var display = is_past ? actual : forecast;

	var html =
		'<div class="budget-group" data-year="' +
		year +
		'" data-month="' +
		month +
		'" data-is-past="' +
		is_past +
		'">';

	if (show_plan) {
		html +=
			'<div class="bg-group-plan' +
			(plan === 0 ? " zero" : "") +
			'"><span class="readonly-fact">' +
			pc.format_amount(plan) +
			"</span></div>";
	}

	html +=
		'<div class="bg-group-actual' +
		(display === 0 ? " zero" : "") +
		'"><span class="readonly-fact">' +
		pc.format_amount(display) +
		"</span></div>";

	html += "</div>";
	return html;
};

pc.render_period_value_cell = function (value, type) {
	var num = flt(value);
	var group_class = type === "plan" ? "bg-group-plan" : "bg-group-actual";

	return (
		'<div class="budget-group budget-group--single">' +
		'<div class="' +
		group_class +
		(num === 0 ? " zero" : "") +
		'"><span class="readonly-fact">' +
		pc.format_amount(value) +
		"</span></div></div>"
	);
};

pc.is_period_primary_column = function (fieldname, filters) {
	var parsed = pc.parse_period_fieldname(fieldname);
	if (!parsed) {
		return false;
	}
	if (parsed.type === "plan") {
		return false;
	}
	return parsed.type === "actual" || parsed.type === "forecast";
};
