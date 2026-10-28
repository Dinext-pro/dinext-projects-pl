frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.destroy_budget_datatable = function () {
	var table = br._budget_datatable;
	br._budget_datatable = null;
	if (!table) return;
	table.destroy();
	$(table.wrapper).removeClass("dt-sticky-table");
	if (frappe.query_report && frappe.query_report.datatable === table) {
		frappe.query_report.datatable = null;
	}
};

br.after_datatable_render = function (datatable) {
	// QueryReport clears its reference before the next report's onload.
	if (br.is_budget_report_view(frappe.query_report)) {
		br._budget_datatable = datatable || frappe.query_report.datatable;
	}
	setTimeout(function () {
		var report = frappe.query_report;
		if (!br.is_budget_report_view(report)) {
			return;
		}

		br.setup_budget_summary_hooks(report);
		if (br.setup_filter_layout) {
			br.setup_filter_layout(report);
		}
		if (br.setup_period_month_pickers) {
			br.setup_period_month_pickers(report);
		}

		var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
		if (cg && typeof cg.ensure_grouped_headers === "function") {
			cg.ensure_grouped_headers(report, 0);
		} else if (cg && typeof cg.schedule_budget_grouped_headers === "function") {
			cg.schedule_budget_grouped_headers(report);
		} else {
			if (cg && cg.apply_grouped_headers) {
				cg.apply_grouped_headers();
			}
			if (br.apply_table_header_translations) {
				br.apply_table_header_translations();
			}
			if (br.fix_table_horizontal_layout) {
				br.fix_table_horizontal_layout();
			}
		}
		br.render_budget_chart(report);
		br.render_budget_summary(report);
		br.disable_budget_report_toolbar_actions(report);
		setTimeout(function () {
			br.hide_budget_report_actions_menu(report);
		}, 0);
		if (br.render_sticky_summary_footer) {
			br.render_sticky_summary_footer(report);
		}
		if (typeof br.sync_budget_insights_layout === "function") {
			br.sync_budget_insights_layout(report);
		}

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

		$(".dt-row-header .dt-cell--header, .budget-period-group-row .dt-cell").addClass(
			"budget-report-header-cell"
		);

		$(".dt-cell--header").each(function () {
			var $headerCell = $(this);
			var fieldname = $headerCell.data("fieldname");
			if (
				fieldname === "total_plan" ||
				fieldname === "total_exp_fct" ||
				fieldname === "total_exp" ||
				fieldname === "total_fct"
			) {
				$headerCell.find(".dt-cell__content").addClass("total-column-header");
			}
		});

		$(".dt-cell").each(function () {
			var $cell = $(this);
			var fieldname = $cell.data("fieldname");

			if (
				fieldname &&
				(fieldname === "total_plan" ||
					fieldname === "total_exp_fct" ||
					fieldname === "total_exp" ||
					fieldname === "total_fct")
			) {
				$cell.find(".dt-cell__content").addClass("total-column-data");
			}
		});

		if (br.bind_account_gl_links) {
			br.bind_account_gl_links();
		}
	}, 100);
};
