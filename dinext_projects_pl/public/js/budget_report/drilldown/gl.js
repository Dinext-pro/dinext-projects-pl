frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;
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

br.get_gl_drilldown_disabled_message = function () {
	return br.__("To view GL entries, select Fact Only and disable Show Plan.");
};

br.parse_gl_drilldown_period = function (fieldname) {
	if (fieldname === "total_fct") {
		var filter_period = br.get_report_filter_period();
		return {
			from_date: filter_period.from_date,
			to_date: filter_period.to_date,
		};
	}

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

	return frappe
		.call({
			method:
				"dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast.get_report_project_options",
			args: {
				txt: "",
				company: filters.company,
			},
		})
		.then(function (response) {
			var writable = (response.message || []).map(function (row) {
				return row.value;
			});
			if (!portfolios.length) {
				return writable;
			}
			return frappe.db
				.get_list("Project", {
					filters: { custom_project_portfolio: ["in", portfolios], name: ["in", writable] },
					fields: ["name"],
					limit: 0,
				})
				.then(function (rows) {
					return (rows || []).map(function (row) {
						return row.name;
					});
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
	br.maybe_show_allocation_gl_disclaimer();
	frappe.route_options = route_options;
	frappe.set_route("query-report", "General Ledger");
};

br.maybe_show_allocation_gl_disclaimer = function () {
	var report = frappe.query_report;
	if (!report || !report.get_filter_value) {
		return;
	}
	if (!cint(report.get_filter_value("apply_cc_allocation"))) {
		return;
	}
	var filters = report.get_filter_values ? report.get_filter_values() : {};
	var has_cc = br.normalize_report_filter_array(filters.cost_center).length;
	var has_ba = br.normalize_report_filter_array(filters.business_area).length;
	if (!has_cc && !has_ba) {
		return;
	}
	frappe.show_alert({
		message: __(
			"Report actuals use cost center allocation; GL drill shows direct postings."
		),
		indicator: "orange",
	});
};

br.is_actual_cell_gl_drilldown = function (fieldname) {
	return Boolean(
		fieldname && (fieldname.startsWith("actual_") || fieldname === "total_fct")
	);
};

br.open_general_ledger_drilldown = function (account, fieldname) {
	if (!account || !fieldname) {
		return;
	}

	if (!br.is_actual_cell_gl_drilldown(fieldname) && !br.is_gl_drilldown_enabled()) {
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

br.open_profit_gl_drilldown = function (fieldname) {
	if (!fieldname) {
		return;
	}
	if (!br.is_actual_cell_gl_drilldown(fieldname) && !br.is_gl_drilldown_enabled()) {
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

br.install_gl_drilldown_handler = function () {
	$(document).off(
		"click.budget_gl_drill",
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
		"click.budget_gl_drill",
		"#page-query-report.budget-plan-vs-forecast-page .budget-gl-drillable",
		function (event) {
			event.preventDefault();
			event.stopPropagation();

			var $target = $(event.currentTarget);
			if ($target.attr("data-drill-target") === "profit") {
				br.handle_profit_summary_drill($target);
				return;
			}

			br.open_general_ledger_drilldown(
				$target.attr("data-account"),
				$target.attr("data-fieldname")
			);
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
	if (
		!fieldname ||
		(!fieldname.startsWith("actual_") && fieldname !== "total_fct") ||
		!data ||
		!data.account
	) {
		return value;
	}
	if (data.is_profit_row || data.is_profitability_row || flt(raw) === 0) {
		return value;
	}

	return (
		'<span class="budget-gl-drillable budget-gl-drillable--active' +
		'" data-account="' +
		frappe.utils.escape_html(data.account) +
		'" data-fieldname="' +
		frappe.utils.escape_html(fieldname) +
		'">' +
		value +
		"</span>"
	);
};
