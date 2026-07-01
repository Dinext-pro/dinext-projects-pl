frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.install_sticky_datatable = function (report) {
	if (!report || report._budget_sticky_datatable_installed) {
		return;
	}
	report._budget_sticky_datatable_installed = true;

	var render_datatable = report.render_datatable.bind(report);
	report.render_datatable = function () {
		br.remove_delta_columns(report);
		br.prepare_sticky_summary_rows(report);

		if (!window.StickyDataTable) {
			console.warn("StickyDataTable is not loaded; falling back to Frappe DataTable");
			var fallback_result = render_datatable();
			br.schedule_budget_grouped_headers_after_render(report);
			return fallback_result;
		}

		var OriginalDataTable = window.DataTable;
		window.DataTable = window.StickyDataTable;
		try {
			var sticky_result = render_datatable();
			br.schedule_budget_grouped_headers_after_render(report);
			return sticky_result;
		} finally {
			window.DataTable = OriginalDataTable;
		}
	};
};

br.schedule_budget_grouped_headers_after_render = function (report) {
	var cg = br.column_groups || dinext_projects_pl.budget_plan_vs_forecast.column_groups;
	if (cg && typeof cg.ensure_grouped_headers === "function") {
		cg.ensure_grouped_headers(report, 0);
	} else if (cg && typeof cg.schedule_budget_grouped_headers === "function") {
		cg.schedule_budget_grouped_headers(report);
	}
};

br.remove_delta_columns = function (report) {
	if (!report) {
		return;
	}

	if (Array.isArray(report.columns)) {
		report.columns = report.columns.filter(function (col) {
			var fieldname = col && (col.fieldname || col.id);
			return !(fieldname && fieldname.indexOf("delta_") === 0);
		});
	}

	if (Array.isArray(report.data)) {
		report.data.forEach(function (row) {
			if (!row) {
				return;
			}
			Object.keys(row).forEach(function (key) {
				if (key.indexOf("delta_") === 0) {
					delete row[key];
				}
			});
		});
	}
};

br.prepare_sticky_summary_rows = function (report) {
	if (!report || !Array.isArray(report.data)) {
		return;
	}

	var profit_row = null;
	var profitability_row = null;
	var root_income_accounts = [];
	var root_expense_accounts = [];
	var filtered = [];

	report.data.forEach(function (row) {
		if (row && cint(row.indent, 0) === 0 && row.root_type === "Income" && row.account) {
			root_income_accounts.push(row.account);
		}
		if (row && cint(row.indent, 0) === 0 && row.root_type === "Expense" && row.account) {
			root_expense_accounts.push(row.account);
		}
		if (row && row.is_profit_row) {
			profit_row = row;
			return;
		}
		if (row && row.is_profitability_row) {
			profitability_row = row;
			return;
		}
		filtered.push(row);
	});

	if (profit_row || profitability_row) {
		report._budget_summary_rows = {
			profit: profit_row,
			profitability: profitability_row,
			root_income_accounts: root_income_accounts,
			root_expense_accounts: root_expense_accounts,
		};
		report.data = filtered;
	}
};

br.get_datatable_options = function (options) {
	if (options.columns) {
		options.columns = options.columns.filter(function (col) {
			var fieldname = col && (col.fieldname || col.id);
			return !(fieldname && fieldname.indexOf("delta_") === 0);
		}).map(function (col) {
			var next_col = Object.assign({}, col, { dropdown: false, sortable: false });
			var label = next_col.label || next_col.name;
			if (label) {
				next_col.label = br.__(label);
				next_col.name = br.__(label);
			}
			if (next_col.id === "account" || next_col.fieldname === "account") {
				next_col.sticky = true;
				next_col.treeView = true;
			}
			return next_col;
		});
	}
	return Object.assign(options, {
		inlineFilters: false,
		disableReorderColumn: true,
		serialNoColumn: false,
		checkboxColumn: false,
		stickyColumnsCount: 1,
		showTotalRow: true,
		dynamicRowHeight: true,
		hooks: Object.assign({}, options.hooks || {}, {
			columnTotal: br.sticky_summary_column_total,
		}),
	});
};

br.sticky_summary_column_total = function (columnValues, cell) {
	var report = frappe.query_report;
	var summary = report && report._budget_summary_rows;
	if (!summary) {
		return "";
	}

	var column = br.get_sticky_summary_column(report, cell);
	var fieldname = column.id || column.fieldname;

	if (fieldname === "account") {
		return (
			'<div class="budget-summary-labels">' +
			'<span class="budget-summary-label budget-summary-label--profit">' +
			br.__("Gross Profit") +
			"</span>" +
			'<span class="budget-summary-label budget-summary-label--profitability">' +
			br.__("Profitability (%)") +
			"</span>" +
			"</div>"
		);
	}

	return (
		'<div class="budget-summary-values">' +
		br.format_summary_value(summary.profit, column, "profit") +
		br.format_summary_value(summary.profitability, column, "profitability") +
		"</div>"
	);
};

br.get_sticky_summary_column = function (report, cell) {
	cell = cell || {};
	if (cell.column && (cell.column.id || cell.column.fieldname)) {
		return cell.column;
	}

	var dt = report && report.datatable;
	var columns = dt && dt.datamanager && dt.datamanager.columns;
	var colIndex = cell.colIndex != null ? cell.colIndex : cell.columnIndex;

	if (columns && colIndex != null) {
		return columns[cint(colIndex)] || {};
	}

	return {};
};

br.render_sticky_summary_footer = function (report) {
	if (!report || !report._budget_summary_rows || !report.datatable) {
		return;
	}

	br.install_sticky_summary_footer_renderer(report);

	var bodyRenderer = report.datatable.bodyRenderer;
	var footer = bodyRenderer && bodyRenderer.footer;
	if (!footer) {
		return;
	}

	// Frappe DataTable formats total-row cells again by fieldtype, which turns
	// our HTML summary into zeros for Currency columns. Keep the single
	// StickyDataTable footer row, but render its two visual lines explicitly.
	$(footer)
		.find(".dt-row-totalRow .dt-cell")
		.each(function () {
			var $cell = $(this);
			var colIndex = $cell.data("col-index");
			var column = br.get_sticky_summary_column(report, { colIndex: colIndex });
			var content = br.sticky_summary_column_total([], {
				column: column,
				colIndex: colIndex,
			});

			$cell.find(".dt-cell__content").html(content);
			$cell.find(".dt-cell__content").attr("title", br.get_sticky_summary_title($cell));
		});

	if (report.datatable._sm && report.datatable._sm.applyToRenderedRows) {
		report.datatable._sm.applyToRenderedRows();
	}

	var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
	if (cg && cg.apply_period_boundary_classes && report.columns) {
		cg.apply_period_boundary_classes(
			cg.get_report_columns_with_groups
				? cg.get_report_columns_with_groups(report)
				: report.columns.filter(function (col) {
						return !col.hidden;
				  }),
			report
		);
	}
};

br.get_sticky_summary_title = function ($cell) {
	var lines = $cell
		.find(".budget-summary-label, .budget-summary-value")
		.map(function () {
			return $(this).text().trim();
		})
		.get()
		.filter(Boolean);

	return lines.length ? lines.join("\n") : $cell.text().trim();
};

br.install_sticky_summary_footer_renderer = function (report) {
	var bodyRenderer = report && report.datatable && report.datatable.bodyRenderer;
	if (!bodyRenderer || bodyRenderer._budget_summary_footer_renderer_installed) {
		return;
	}

	bodyRenderer._budget_summary_footer_renderer_installed = true;
	var renderFooter = bodyRenderer.renderFooter.bind(bodyRenderer);

	bodyRenderer.renderFooter = function () {
		var result = renderFooter();
		br.render_sticky_summary_footer(report);
		return result;
	};
};

br.format_summary_value = function (row, column, row_type) {
	var fieldname = column.id || column.fieldname;
	var value = row ? flt(row[fieldname]) : 0;
	var css_class = "budget-summary-value budget-summary-value--" + row_type;

	if (row_type === "profit" && value > 0) {
		css_class += " text-success";
	} else if (row_type === "profit" && value < 0) {
		css_class += " text-danger";
	}

	var display_value;
	if (row_type === "profitability") {
		display_value = String(value).replace(/\.0$/, "") + "%";
	} else {
		display_value = dinext_projects_pl.budget_plan_vs_forecast.period_cells.format_amount(value);
	}

	var inner_html = '<span class="' + css_class + '">' + display_value + "</span>";
	return br.wrap_summary_drilldown_value(inner_html, row_type, fieldname, value);
};
