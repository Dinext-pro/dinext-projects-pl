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
		if (!col || !col.period_group || seen[col.period_group]) {
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

br.build_budget_chart_data = function (report) {
	var data = report.data || [];
	var columns = report.columns || [];
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
		periods.push({ label: group.label, key: group.key });

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

	var cumulative_profit_plan = [];
	var cumulative_profit_actual = [];
	var accumulated_values = cint(
		report.get_filter_value && report.get_filter_value("accumulated_values")
	);

	if (accumulated_values) {
		cumulative_profit_plan = profit_plan.slice();
		cumulative_profit_actual = profit_actual.slice();
	} else {
		var cum_plan = 0;
		var cum_actual = 0;
		for (var i = 0; i < profit_plan.length; i++) {
			cum_plan += profit_plan[i];
			cum_actual += profit_actual[i];
			cumulative_profit_plan.push(parseFloat(cum_plan.toFixed(2)));
			cumulative_profit_actual.push(parseFloat(cum_actual.toFixed(2)));
		}
	}

	return {
		labels: labels,
		plan_income: plan_income,
		actual_income: actual_income,
		plan_expenses: plan_expenses,
		actual_expenses: actual_expenses,
		profit_plan: profit_plan,
		profit_actual: profit_actual,
		cumulative_profit_plan: cumulative_profit_plan,
		cumulative_profit_actual: cumulative_profit_actual,
		periods: periods,
	};
};

br.get_budget_chart_presentation = function (report) {
	var filters = report.get_filter_values();
	var raw = br.build_budget_chart_data(report);
	var view = br.get_budget_chart_view_label(filters);
	var accumulated = cint(filters.accumulated_values);
	var datasets = [];

	if (accumulated) {
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

		return {
			labels: raw.labels,
			datasets: datasets,
			yMarkers: null,
			dataObj: raw,
		};
	}

	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Income - plan"),
			values: raw.plan_income,
			chartType: "bar",
			plLayer: "bar",
			plSeriesKind: "income",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Income") + " - " + view,
		values: raw.actual_income,
		chartType: "bar",
		plLayer: "bar",
		plSeriesKind: "income",
		plIsPlan: false,
	});
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Expenses - plan"),
			values: raw.plan_expenses,
			chartType: "bar",
			plLayer: "bar",
			plSeriesKind: "expense",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Expenses") + " - " + view,
		values: raw.actual_expenses,
		chartType: "bar",
		plLayer: "bar",
		plSeriesKind: "expense",
		plIsPlan: false,
	});
	if (cint(filters.show_plan)) {
		datasets.push({
			name: br.__("Profit - plan"),
			values: raw.profit_plan,
			chartType: "line",
			plLayer: "profit",
			plSeriesKind: "period_profit",
			plIsPlan: true,
		});
	}
	datasets.push({
		name: br.__("Profit") + " - " + view,
		values: raw.profit_actual,
		chartType: "line",
		plLayer: "profit",
		plSeriesKind: "period_profit",
		plIsPlan: false,
	});
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
		budget_view_options: budget_view_options,
	};
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

	if ($summary.index() < $chart.index()) {
		$chart.insertBefore($summary);
	}
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
			$container.insertBefore($summary);
		} else {
			$header.prepend($container);
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
