frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.install_sticky_datatable = function (report) {
	if (!report || report._budget_sticky_datatable_installed) {
		return;
	}
	report._budget_sticky_datatable_installed = true;

	var render_datatable = report.render_datatable.bind(report);
	report.render_datatable = function () {
		br.prepare_sticky_summary_rows(report);

		if (!window.StickyDataTable) {
			console.warn("StickyDataTable is not loaded; falling back to Frappe DataTable");
			return render_datatable();
		}

		var OriginalDataTable = window.DataTable;
		window.DataTable = window.StickyDataTable;
		try {
			return render_datatable();
		} finally {
			window.DataTable = OriginalDataTable;
		}
	};
};

br.prepare_sticky_summary_rows = function (report) {
	if (!report || !Array.isArray(report.data)) {
		return;
	}

	var profit_row = null;
	var profitability_row = null;
	var filtered = [];

	report.data.forEach(function (row) {
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
		};
		report.data = filtered;
	}
};

br.get_datatable_options = function (options) {
	if (options.columns) {
		options.columns = options.columns.map(function (col) {
			var next_col = Object.assign({}, col, { dropdown: false, sortable: false });
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
			__("Gross Profit") +
			"</span>" +
			'<span class="budget-summary-label budget-summary-label--profitability">' +
			__("Profitability (%)") +
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
	var is_delta = fieldname && fieldname.indexOf("delta_") === 0;
	var css_class = "budget-summary-value budget-summary-value--" + row_type;

	if (row_type === "profit" && value > 0) {
		css_class += " text-success";
	} else if (row_type === "profit" && value < 0) {
		css_class += " text-danger";
	}

	var display_value;
	if (is_delta || row_type === "profitability") {
		display_value = String(value).replace(/\.0$/, "") + "%";
	} else {
		display_value = dinext_projects_pl.budget_plan_vs_forecast.period_cells.format_amount(value);
	}

	return '<span class="' + css_class + '">' + display_value + "</span>";
};
