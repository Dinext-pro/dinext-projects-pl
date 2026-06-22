frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.apply_report_styles = function () {
	var styles = `
		.report-wrapper {
			--budget-report-header-bg: var(--subtle-fg, #f8f9fa);
			--budget-report-header-color: var(--text-color, #212529);
			--budget-report-summary-bg: var(--control-bg, var(--card-bg, #f8f9fa));
			--budget-report-first-column-z-index: 4;
			--budget-report-header-z-index: 6;
			--budget-report-summary-z-index: 5;
		}

		.report-wrapper .dt-cell__content {
			text-align: right !important;
		}

		.report-wrapper .dt-cell--col-0 {
			position: sticky;
			left: 0;
			z-index: var(--budget-report-first-column-z-index);
			background-color: var(--card-bg, #fff);
		}

		.report-wrapper .dt-cell--col-0 .dt-cell__content {
			text-align: left !important;
		}

		.report-wrapper .dt-row-header .dt-cell--col-0,
		.report-wrapper .budget-sticky-first-column {
			position: sticky;
			left: 0;
			z-index: var(--budget-report-header-z-index);
			background-color: var(--budget-report-header-bg) !important;
			color: var(--budget-report-header-color) !important;
		}

		.report-wrapper .budget-period-group-row {
			display: flex;
			flex-direction: row;
			background-color: var(--budget-report-header-bg);
			color: var(--budget-report-header-color);
		}

		.report-wrapper .budget-period-group-cell .budget-period-group-label {
			text-align: center;
			font-weight: 600;
			width: 100%;
			color: var(--budget-report-header-color);
		}

		.report-wrapper .budget-report-header-cell {
			border-bottom: 1px solid var(--border-color, #d1d8dd);
			background-color: var(--budget-report-header-bg) !important;
			color: var(--budget-report-header-color) !important;
		}

		.report-wrapper .dt-header .dt-row-header,
		.report-wrapper .dt-header .dt-row-header .dt-cell,
		.report-wrapper .dt-header .dt-row-header .dt-cell--header,
		.report-wrapper .dt-header .dt-row-header .dt-cell__content {
			background-color: var(--budget-report-header-bg) !important;
			color: var(--budget-report-header-color) !important;
		}

		.report-wrapper .budget-report-header-cell .dt-cell__content,
		.report-wrapper .dt-cell--header .dt-cell__content,
		.report-wrapper .dt-row-header .dt-cell--header .dt-cell__content {
			font-size: 11px;
			text-align: center !important;
			display: flex;
			justify-content: center !important;
			align-items: center !important;
		}

		.report-wrapper .budget-group-header {
			display: flex;
			justify-content: space-around;
		}

		.report-wrapper .budget-group-header > span {
			width: 33.33%;
			font-size: 10px;
			display: flex;
			justify-content: center;
		}

		.report-wrapper .budget-group {
			display: flex;
			flex-direction: row;
			flex-wrap: nowrap;
			justify-content: space-around;
		}

		.report-wrapper .budget-group span {
			font-size: smaller;
		}

		.report-wrapper .budget-group > div {
			min-width: 3em;
			text-align: center;
		}

		.report-wrapper .budget-group > div.zero,
		.report-wrapper .zero {
			color: var(--gray-500, #999);
			opacity: 0.6;
		}

		.profit-row {
			font-weight: bold !important;
		}

		.budget-summary-row-start .dt-cell__content {
			border-top: 2px solid var(--border-color, #dee2e6) !important;
		}

		.profitability-row {
			font-style: italic !important;
		}

		.report-wrapper .dt-row-totalRow .dt-cell,
		.report-wrapper .dt-row-totalRow .dt-cell__content {
			background-color: var(--budget-report-summary-bg) !important;
			height: auto !important;
		}

		.report-wrapper .dt-row-totalRow .dt-cell__content {
			padding-top: 4px;
			padding-bottom: 4px;
		}

		.report-wrapper .budget-summary-values,
		.report-wrapper .budget-summary-labels {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.report-wrapper .budget-summary-label {
			font-weight: 700;
			text-align: left;
		}

		.report-wrapper .budget-summary-label--profitability,
		.report-wrapper .budget-summary-value--profitability {
			font-style: italic;
		}

		.report-wrapper .budget-summary-value {
			display: block;
			text-align: right;
		}

		.indent-1 { padding-left: 20px !important; }
		.indent-2 { padding-left: 40px !important; }
		.indent-3 { padding-left: 60px !important; }
		.indent-4 { padding-left: 80px !important; }
		.indent-5 { padding-left: 100px !important; }

		.total-column-header {
			font-weight: bold !important;
			color: var(--budget-report-header-color) !important;
			background-color: var(--budget-report-header-bg) !important;
			text-align: center !important;
		}

		.total-column-data {
			font-weight: 600 !important;
			background-color: var(--budget-report-summary-bg) !important;
		}

		[data-fieldname="total_plan"] .dt-cell__content,
		[data-fieldname="total_exp_fct"] .dt-cell__content,
		[data-fieldname="total_exp"] .dt-cell__content,
		[data-fieldname="total_fct"] .dt-cell__content {
			font-weight: 600 !important;
			background-color: var(--budget-report-summary-bg) !important;
		}

		[data-fieldname="total_plan"],
		[data-fieldname="total_exp_fct"],
		[data-fieldname="total_exp"],
		[data-fieldname="total_fct"] {
			border-left: 2px solid #dee2e6 !important;
		}

		.dt-cell--header[data-fieldname="total_plan"] .dt-cell__content,
		.dt-cell--header[data-fieldname="total_exp_fct"] .dt-cell__content,
		.dt-cell--header[data-fieldname="total_exp"] .dt-cell__content,
		.dt-cell--header[data-fieldname="total_fct"] .dt-cell__content {
			font-weight: 700 !important;
			color: var(--budget-report-header-color) !important;
			background-color: var(--budget-report-header-bg) !important;
			border-bottom: 2px solid #adb5bd !important;
		}

		.budget-detail-table {
			width: 100%;
			border-collapse: collapse;
			margin-top: 10px;
		}

		.budget-detail-table th {
			background-color: #f8f9fa;
			font-weight: bold;
			padding: 8px;
			text-align: left;
			border-bottom: 2px solid #dee2e6;
		}

		.budget-detail-table td {
			padding: 6px 8px;
			border-bottom: 1px solid #e9ecef;
		}

		.budget-detail-table tr:hover {
			background-color: #f1f3f4;
		}

		.detail-header {
			font-size: 16px;
			font-weight: bold;
			margin-bottom: 15px;
			padding-bottom: 10px;
			border-bottom: 2px solid #1a73e8;
			color: #1a73e8;
		}

		.detail-subheader {
			font-size: 14px;
			margin-bottom: 10px;
			color: #5f6368;
		}

		.drillable-amount {
			cursor: pointer !important;
			text-decoration: underline dotted !important;
			color: inherit !important;
			border-bottom: 1px dashed #aaa;
		}

		.drillable-amount:hover {
			text-decoration: underline solid !important;
			font-weight: 600;
			background-color: #f5f5f5;
		}

		#page-query-report .page-form > [data-fieldtype="MultiSelectList"] {
			width: 260px !important;
			min-width: 260px !important;
			max-width: 320px !important;
			flex: 0 0 260px !important;
			float: none !important;
		}

		#page-query-report .page-form > [data-fieldtype="MultiSelectList"] .multiselect-list,
		#page-query-report .page-form > [data-fieldtype="MultiSelectList"] .multiselect-list .form-control {
			width: 100% !important;
			min-width: 100% !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form > [data-fieldtype="MultiSelectList"] {
			width: 260px !important;
			min-width: 260px !important;
			max-width: 320px !important;
			flex: 0 0 260px !important;
			float: none !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form > .budget-report-filter-wide,
		#page-query-report.budget-plan-vs-forecast-page .page-form > .form-group.budget-report-filter-wide,
		#page-query-report.budget-plan-vs-forecast-page .page-form > .frappe-control.budget-report-filter-wide {
			width: 260px !important;
			min-width: 260px !important;
			max-width: 320px !important;
			flex: 0 0 260px !important;
			float: none !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form .budget-report-filter-wide .multiselect-list,
		#page-query-report.budget-plan-vs-forecast-page .page-form .budget-report-filter-wide .multiselect-list .form-control {
			width: 100% !important;
			min-width: 100% !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form .budget-report-filter-wide .status-text {
			max-width: 100%;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form > [data-fieldname="company"] {
			width: 180px !important;
			min-width: 180px !important;
			flex: 0 0 180px !important;
			float: none !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form > [data-fieldname="from_period"],
		#page-query-report.budget-plan-vs-forecast-page .page-form > [data-fieldname="to_period"] {
			width: 110px !important;
			min-width: 110px !important;
			flex: 0 0 110px !important;
			float: none !important;
		}
	`;

	var styleSheet = document.createElement("style");
	styleSheet.textContent = styles;
	document.head.appendChild(styleSheet);
};
