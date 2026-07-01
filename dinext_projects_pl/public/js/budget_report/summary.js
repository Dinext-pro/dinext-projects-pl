frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

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
	if (!br.is_budget_report_view(report)) {
		return null;
	}

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
		var $insights = br.ensure_budget_report_insights_header(report);
		if ($insights && $insights.length && !$existing.closest(".budget-report-insights").length) {
			var $chart = $insights.find(".budget-report-chart-container").first();
			if ($chart.length) {
				$existing.insertBefore($chart);
			} else {
				$existing.prependTo($insights);
			}
		}
		if (typeof br.sync_budget_insights_layout === "function") {
			br.sync_budget_insights_layout(report);
		}
		return $existing;
	}

	var $summary = $('<div class="report-summary budget-pl-summary"></div>');
	var $insights = br.ensure_budget_report_insights_header(report);
	var $filters = $page.find(".page-form.budget-report-filters-form").first();
	if (!$filters.length) {
		$filters = $page.find(".page-form").first();
	}
	var $report = (report && report.$report) || $page.find(".report-wrapper").first();

	if ($insights && $insights.length) {
		var $chart = $insights.find(".budget-report-chart-container").first();
		if ($chart.length) {
			$summary.insertBefore($chart);
		} else {
			$summary.prependTo($insights);
		}
		if (typeof br.sync_budget_insights_layout === "function") {
			br.sync_budget_insights_layout(report);
		}
	} else if ($filters.length) {
		$summary.insertBefore($filters);
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
	var accumulated_values = cint(
		report.get_filter_value && report.get_filter_value("accumulated_values")
	);

	var filters = report.get_filter_values ? report.get_filter_values() : {};
	var riskTotals = report._budget_risk_totals;

	if (accumulated_values && period_groups.length) {
		var last_group = period_groups[period_groups.length - 1];
		income_display = br.sum_row_fields(income_roots, last_group.display);
		expense_display = br.sum_row_fields(expense_roots, last_group.display);
	} else {
		period_groups.forEach(function (group) {
			income_display += br.sum_row_fields(income_roots, group.display);
			expense_display += br.sum_row_fields(expense_roots, group.display);
		});
	}

	expense_display += br.sumRiskDisplayExpense(riskTotals, period_groups, filters);
	expense_display = Math.abs(expense_display);

	return {
		income: income_display,
		expense: expense_display,
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
	if (!report || !br.is_budget_report_view(report)) {
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

	if (typeof br.sync_budget_insights_layout === "function") {
		br.sync_budget_insights_layout(report);
	}
};

br.setup_budget_summary_hooks = function (report) {
	if (!report || report._budget_summary_hooks_installed) {
		return;
	}
	report._budget_summary_hooks_installed = true;

	var original_refresh = report.refresh.bind(report);
	report.refresh = function (have_filters_changed) {
		return original_refresh(have_filters_changed).then(function (result) {
			if (br.is_budget_report_view(report)) {
				br.render_budget_summary(report);
			}
			return result;
		});
	};
};
