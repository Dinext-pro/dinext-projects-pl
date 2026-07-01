frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

var BUDGET_CHART_ASSETS = [
	"/assets/dinext_common/js/echarts.min.js",
	"/assets/dinext_projects_pl/js/project_pl_echarts.js",
];

br._budget_chart_instance = null;
br._budget_chart_resize_observer = null;

br.get_budget_chart_view_label = function (filters) {
	filters = filters || {};
	if (filters.view_type === "forecast_only") {
		return br.__("Exp Only");
	}
	if (filters.view_type === "actual_only") {
		return br.__("Fact Only");
	}
	return br.__("Exp and Fact");
};

br.get_budget_root_rows = function (data) {
	return (data || []).filter(function (row) {
		if (!row || row.is_profit_row || row.is_profitability_row) {
			return false;
		}
		return cint(row.indent, 0) === 0 && (row.root_type === "Income" || row.root_type === "Expense");
	});
};

br.get_budget_period_groups = function (columns) {
	var groups = [];
	var seen = {};

	(columns || []).forEach(function (col) {
		if (!col || !col.period_group || col.period_group === "total" || seen[col.period_group]) {
			return;
		}
		seen[col.period_group] = true;
		groups.push({
			key: col.period_group,
			label: col.period_group_label || col.period_group,
			plan: [],
			display: [],
		});
	});

	var group_map = {};
	groups.forEach(function (group) {
		group_map[group.key] = group;
	});

	(columns || []).forEach(function (col) {
		if (!col || !col.period_group || !group_map[col.period_group]) {
			return;
		}
		var group = group_map[col.period_group];
		var role = col.period_role || (col.fieldname || "").split("_")[0];
		if (role === "plan") {
			group.plan.push(col.fieldname);
		} else {
			group.display.push(col.fieldname);
		}
	});

	return groups;
};

br.sum_row_fields = function (rows, fieldnames) {
	var total = 0;
	(rows || []).forEach(function (row) {
		(fieldnames || []).forEach(function (fieldname) {
			total += flt(row[fieldname]);
		});
	});
	return total;
};

br.parse_budget_chart_period_meta = function (periodKey) {
	if (!periodKey || periodKey === "total") {
		return {};
	}

	var parts = String(periodKey).split("_");
	if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
		return { year: parseInt(parts[0], 10) };
	}
	if (parts.length === 2 && /^Q[1-4]$/i.test(parts[1])) {
		return {
			year: parseInt(parts[0], 10),
			quarter: parseInt(parts[1].slice(1), 10),
		};
	}
	if (parts.length === 2 && /^\d{2}$/.test(parts[1])) {
		return {
			year: parseInt(parts[0], 10),
			month: parseInt(parts[1], 10),
		};
	}
	return {};
};

br.summarize_budget_chart_periods = function (data, columns) {
	var period_groups = br.get_budget_period_groups(columns);
	var income_roots = br.get_budget_root_rows(data).filter(function (row) {
		return row.root_type === "Income";
	});
	var expense_roots = br.get_budget_root_rows(data).filter(function (row) {
		return row.root_type === "Expense";
	});

	var labels = [];
	var plan_income = [];
	var actual_income = [];
	var plan_expenses = [];
	var actual_expenses = [];
	var profit_plan = [];
	var profit_actual = [];
	var periods = [];

	period_groups.forEach(function (group) {
		labels.push(group.label);
		periods.push(
			Object.assign(
				{ label: group.label, key: group.key },
				br.parse_budget_chart_period_meta(group.key)
			)
		);

		var income_plan = br.sum_row_fields(income_roots, group.plan);
		var income_actual = br.sum_row_fields(income_roots, group.display);
		var expense_plan = br.sum_row_fields(expense_roots, group.plan);
		var expense_actual = br.sum_row_fields(expense_roots, group.display);

		plan_income.push(parseFloat(income_plan.toFixed(2)));
		actual_income.push(parseFloat(income_actual.toFixed(2)));
		plan_expenses.push(parseFloat((-expense_plan).toFixed(2)));
		actual_expenses.push(parseFloat((-expense_actual).toFixed(2)));
		profit_plan.push(parseFloat((income_plan - expense_plan).toFixed(2)));
		profit_actual.push(parseFloat((income_actual - expense_actual).toFixed(2)));
	});

	return {
		labels: labels,
		plan_income: plan_income,
		actual_income: actual_income,
		plan_expenses: plan_expenses,
		actual_expenses: actual_expenses,
		profit_plan: profit_plan,
		profit_actual: profit_actual,
		periods: periods,
	};
};

br.derive_period_values_from_cumulative = function (values) {
	var period = [];
	var previous = 0;

	(values || []).forEach(function (value) {
		var current = flt(value);
		period.push(parseFloat((current - previous).toFixed(2)));
		previous = current;
	});

	return period;
};

br.resolve_budget_chart_period_values = function (raw, accumulated) {
	if (!accumulated) {
		return {
			plan_income: raw.plan_income,
			actual_income: raw.actual_income,
			plan_expenses: raw.plan_expenses,
			actual_expenses: raw.actual_expenses,
			profit_plan: raw.profit_plan,
			profit_actual: raw.profit_actual,
		};
	}

	if (raw.period_plan_income) {
		return {
			plan_income: raw.period_plan_income,
			actual_income: raw.period_actual_income,
			plan_expenses: raw.period_plan_expenses,
			actual_expenses: raw.period_actual_expenses,
			profit_plan: raw.period_profit_plan,
			profit_actual: raw.period_profit_actual,
		};
	}

	return {
		plan_income: br.derive_period_values_from_cumulative(raw.plan_income),
		actual_income: br.derive_period_values_from_cumulative(raw.actual_income),
		plan_expenses: br.derive_period_values_from_cumulative(raw.plan_expenses),
		actual_expenses: br.derive_period_values_from_cumulative(raw.actual_expenses),
		profit_plan: br.derive_period_values_from_cumulative(raw.profit_plan),
		profit_actual: br.derive_period_values_from_cumulative(raw.profit_actual),
	};
};

br.append_budget_period_bar_datasets = function (datasets, periodValues, filters, view) {
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Income - plan"),
			values: periodValues.plan_income,
			chartType: "bar",
			plLayer: "bar",
			plSeriesKind: "income",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Income") + " - " + view,
		values: periodValues.actual_income,
		chartType: "bar",
		plLayer: "bar",
		plSeriesKind: "income",
		plIsPlan: false,
	});
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Expenses - plan"),
			values: periodValues.plan_expenses,
			chartType: "bar",
			plLayer: "bar",
			plSeriesKind: "expense",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Expenses") + " - " + view,
		values: periodValues.actual_expenses,
		chartType: "bar",
		plLayer: "bar",
		plSeriesKind: "expense",
		plIsPlan: false,
	});
};

br.append_budget_cumulative_profit_datasets = function (datasets, raw, filters, view) {
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Cumulative profit - plan"),
			values: raw.cumulative_profit_plan,
			chartType: "line",
			plLayer: "cumulative",
			plSeriesKind: "cumulative_profit",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Cumulative profit") + " - " + view,
		values: raw.cumulative_profit_actual,
		chartType: "line",
		plLayer: "cumulative",
		plSeriesKind: "cumulative_profit",
		plIsPlan: false,
	});
};

br.append_budget_cumulative_line_datasets = function (datasets, raw, filters, view) {
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Cumulative income - plan"),
			values: raw.plan_income,
			chartType: "line",
			plLayer: "cumulative",
			plSeriesKind: "cumulative_income",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Cumulative income") + " - " + view,
		values: raw.actual_income,
		chartType: "line",
		plLayer: "cumulative",
		plSeriesKind: "cumulative_income",
		plIsPlan: false,
	});
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Cumulative expenses - plan"),
			values: raw.plan_expenses,
			chartType: "line",
			plLayer: "cumulative",
			plSeriesKind: "cumulative_expense",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Cumulative expenses") + " - " + view,
		values: raw.actual_expenses,
		chartType: "line",
		plLayer: "cumulative",
		plSeriesKind: "cumulative_expense",
		plIsPlan: false,
	});
	br.append_budget_cumulative_profit_datasets(datasets, raw, filters, view);
};

br.append_budget_period_profit_datasets = function (datasets, periodValues, filters, view) {
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Profit - plan"),
			values: periodValues.profit_plan,
			chartType: "line",
			plLayer: "profit",
			plSeriesKind: "period_profit",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Profit") + " - " + view,
		values: periodValues.profit_actual,
		chartType: "line",
		plLayer: "profit",
		plSeriesKind: "period_profit",
		plIsPlan: false,
	});
};

br.build_budget_chart_data = function (report) {
	var data = report.data || [];
	var columns = report.columns || [];
	var summary = br.summarize_budget_chart_periods(data, columns);
	var accumulated_values = cint(
		report.get_filter_value && report.get_filter_value("accumulated_values")
	);

	var cumulative_profit_plan = [];
	var cumulative_profit_actual = [];

	if (accumulated_values) {
		cumulative_profit_plan = summary.profit_plan.slice();
		cumulative_profit_actual = summary.profit_actual.slice();
	} else {
		var cum_plan = 0;
		var cum_actual = 0;
		for (var i = 0; i < summary.profit_plan.length; i++) {
			cum_plan += summary.profit_plan[i];
			cum_actual += summary.profit_actual[i];
			cumulative_profit_plan.push(parseFloat(cum_plan.toFixed(2)));
			cumulative_profit_actual.push(parseFloat(cum_actual.toFixed(2)));
		}
	}

	var result = {
		labels: summary.labels,
		plan_income: summary.plan_income,
		actual_income: summary.actual_income,
		plan_expenses: summary.plan_expenses,
		actual_expenses: summary.actual_expenses,
		profit_plan: summary.profit_plan,
		profit_actual: summary.profit_actual,
		cumulative_profit_plan: cumulative_profit_plan,
		cumulative_profit_actual: cumulative_profit_actual,
		periods: summary.periods,
	};

	if (accumulated_values) {
		var periodSource = report._budget_source_snapshot;
		if (periodSource && periodSource.length) {
			var periodSummary = br.summarize_budget_chart_periods(periodSource, columns);
			result.period_plan_income = periodSummary.plan_income;
			result.period_actual_income = periodSummary.actual_income;
			result.period_plan_expenses = periodSummary.plan_expenses;
			result.period_actual_expenses = periodSummary.actual_expenses;
			result.period_profit_plan = periodSummary.profit_plan;
			result.period_profit_actual = periodSummary.profit_actual;
		}
	}

	return result;
};

br.get_budget_chart_presentation = function (report) {
	var filters = report.get_filter_values();
	var raw = br.build_budget_chart_data(report);
	var view = br.get_budget_chart_view_label(filters);
	var accumulated = cint(filters.accumulated_values);
	var periodValues = br.resolve_budget_chart_period_values(raw, accumulated);
	var datasets = [];

	if (accumulated) {
		br.append_budget_cumulative_line_datasets(datasets, raw, filters, view);
	}

	br.append_budget_period_bar_datasets(datasets, periodValues, filters, view);

	if (!accumulated) {
		br.append_budget_period_profit_datasets(datasets, periodValues, filters, view);
		br.append_budget_cumulative_profit_datasets(datasets, raw, filters, view);
	}

	return {
		labels: raw.labels,
		datasets: datasets,
		yMarkers: null,
		dataObj: raw,
	};
};

br.build_budget_chart_frm = function (report) {
	var filters = report.get_filter_values();
	var budget_view_options = __("Forecast and actual");
	if (filters.view_type === "forecast_only") {
		budget_view_options = __("Forecast only");
	} else if (filters.view_type === "actual_only") {
		budget_view_options = __("Actual only");
	}

	var company = filters.company;
	if (Array.isArray(company)) {
		company = company[0];
	}

	return {
		doc: { company: company },
		bg_hide_plan: !cint(filters.show_plan),
		budget_accumulated_values: cint(filters.accumulated_values),
		pl_chart_expanded: false,
		hide_pl_chart_expanded_toggle: true,
		hide_current_date_mark_line_label: true,
		budget_view_options: budget_view_options,
	};
};

br.disable_budget_report_toolbar_actions = function (report) {
	if (!report || report._budget_toolbar_actions_disabled) {
		return;
	}
	report._budget_toolbar_actions_disabled = true;

	report.add_chart_buttons_to_toolbar = function () {};
	report.add_card_button_to_toolbar = function () {};
};

br.hide_budget_report_actions_menu = function (report) {
	if (!report || !report.page) {
		return;
	}

	if (typeof report.page.hide_actions_menu === "function") {
		report.page.hide_actions_menu();
	}

	if (report.page.custom_actions && report.page.custom_actions.length) {
		report.page.custom_actions.addClass("hide");
	}

	if (typeof report.page.get_inner_group_button === "function") {
		report.page.get_inner_group_button(__("Actions")).remove();
	}
};

br.ensure_budget_report_insights_header = function (report) {
	if (!report || !report.page) {
		return null;
	}

	var $page = report.page.wrapper.closest("#page-query-report");
	if (!$page.length) {
		$page = $("#page-query-report");
	}
	if (!$page.length) {
		return null;
	}

	if (report.$budget_report_insights && report.$budget_report_insights.length) {
		return report.$budget_report_insights;
	}

	var $header = $page.find(".budget-report-insights").first();
	if (!$header.length) {
		$header = $('<div class="budget-report-insights"></div>');
		var $form = $page.find(".page-form.budget-report-filters-form").first();
		if (!$form.length) {
			$form = $page.find(".page-form").first();
		}
		if ($form.length) {
			$header.insertBefore($form);
		} else {
			var $main = $page.find(".layout-main-section").first();
			if ($main.length) {
				$main.prepend($header);
			} else {
				report.page.wrapper.prepend($header);
			}
		}
	}

	report.$budget_report_insights = $header;
	return $header;
};

br.sync_budget_insights_layout = function (report) {
	var $insights = br.ensure_budget_report_insights_header(report);
	if (!$insights || !$insights.length) {
		return;
	}

	var $chart = $insights.find(".budget-report-chart-container").first();
	var $summary = $insights.find(".budget-pl-summary").first();
	if (!$chart.length || !$summary.length) {
		return;
	}

	$summary.insertBefore($chart);
};

br.ensure_budget_chart_container = function (report) {
	var $header = br.ensure_budget_report_insights_header(report);
	if (!$header || !$header.length) {
		return null;
	}

	var $container = $header.find(".budget-report-chart-container").first();
	if (!$container.length) {
		$container = $('<div class="budget-report-chart-container"></div>');
		var $summary = $header.find(".budget-pl-summary").first();
		if ($summary.length) {
			$container.insertAfter($summary);
		} else {
			$header.append($container);
		}
	}

	br.sync_budget_insights_layout(report);

	var $chart = $container.find(".budget-report-chart").first();
	if (!$chart.length) {
		$chart = $('<div class="budget-report-chart"></div>').appendTo($container);
	}

	if (report && report.$report) {
		report.$report.find(".budget-report-chart-container").remove();
	}

	return $chart.get(0);
};

br.resize_budget_chart = function () {
	if (br._budget_chart_instance) {
		br._budget_chart_instance.resize();
	}
};

br.ensure_budget_chart_resize_observer = function (chart_dom) {
	if (typeof ResizeObserver === "undefined" || !chart_dom) {
		return;
	}

	if (br._budget_chart_resize_observer) {
		br._budget_chart_resize_observer.disconnect();
	}

	br._budget_chart_resize_observer = new ResizeObserver(function () {
		br.resize_budget_chart();
	});
	br._budget_chart_resize_observer.observe(chart_dom);
};

br.render_budget_chart = function (report) {
	if (!report || !report.data || !report.data.length) {
		return;
	}

	frappe.require(BUDGET_CHART_ASSETS, function () {
		if (!window.echarts || typeof globalThis.get_pl_echarts_option !== "function") {
			return;
		}

		var chart_dom = br.ensure_budget_chart_container(report);
		if (!chart_dom) {
			return;
		}

		var chart_data = br.get_budget_chart_presentation(report);
		var frm = br.build_budget_chart_frm(report);
		var option = globalThis.get_pl_echarts_option(frm, chart_data);

		if (!br._budget_chart_instance || br._budget_chart_instance.getDom() !== chart_dom) {
			if (br._budget_chart_instance) {
				br._budget_chart_instance.dispose();
			}
			br._budget_chart_instance = window.echarts.init(chart_dom);
			br.ensure_budget_chart_resize_observer(chart_dom);
		}

		br._budget_chart_instance.setOption(option, true);
		br.resize_budget_chart();
	});
};

br.destroy_budget_chart = function () {
	if (br._budget_chart_resize_observer) {
		br._budget_chart_resize_observer.disconnect();
		br._budget_chart_resize_observer = null;
	}
	if (br._budget_chart_instance) {
		br._budget_chart_instance.dispose();
		br._budget_chart_instance = null;
	}
};
