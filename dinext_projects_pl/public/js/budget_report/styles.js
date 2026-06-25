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
			--budget-report-period-border: var(--gray-400, #ced4da);
		}

		html[data-theme="dark"] .report-wrapper,
		html[data-theme-mode="dark"] .report-wrapper {
			--budget-report-period-border: var(--gray-600, #6c757d);
		}

		.report-wrapper .dt-cell__content {
			font-size: 12px;
			font-variant-numeric: tabular-nums;
			text-align: center !important;
		}

		.report-wrapper .dt-cell--col-0 {
			position: sticky;
			left: 0;
			z-index: var(--budget-report-first-column-z-index);
			background-color: var(--card-bg, #fff);
		}

		.report-wrapper .dt-cell--col-0 .dt-cell__content {
			font-size: 12px;
			text-align: left !important;
		}

		.report-wrapper .dt-cell:not(.dt-cell--col-0):not(.dt-cell--header) .dt-cell__content {
			font-size: 12px;
			white-space: nowrap;
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
			font-size: 12px;
			text-align: center;
			font-weight: 600;
			width: 100%;
			color: var(--budget-report-header-color);
		}

		.report-wrapper .budget-period-boundary {
			border-left: 1px solid var(--budget-report-period-border) !important;
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
			font-size: 12px;
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
			font-size: 12px;
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
			font-size: 12px;
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

		.report-wrapper .dt-row-totalRow,
		.report-wrapper .dt-row-totalRow .dt-cell,
		.report-wrapper .dt-row-totalRow .dt-cell__content {
			background-color: var(--budget-report-summary-bg) !important;
			height: auto !important;
			min-height: 48px;
		}

		.report-wrapper .dt-row-totalRow .dt-cell__content {
			font-size: 12px;
			padding-top: 4px;
			padding-bottom: 4px;
		}

		.report-wrapper .budget-summary-values,
		.report-wrapper .budget-summary-labels {
			display: flex;
			flex-direction: column;
			gap: 1px;
			line-height: 1.35;
		}

		.report-wrapper .budget-summary-label {
			display: block;
			font-size: 12px;
			font-weight: 700;
			text-align: left;
		}

		.report-wrapper .budget-summary-label--profitability,
		.report-wrapper .budget-summary-value--profitability {
			font-style: italic;
		}

		.report-wrapper .budget-summary-value {
			display: block;
			font-size: 12px;
			text-align: center;
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
			border-left: 1px solid var(--budget-report-period-border) !important;
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

		.report-wrapper .budget-gl-drillable--active {
			cursor: pointer;
			text-decoration: underline dotted;
			border-bottom: 1px dashed var(--gray-500, #868e96);
		}

		.report-wrapper .budget-gl-drillable--active:hover {
			text-decoration: underline solid;
			font-weight: 600;
			background-color: var(--highlight-color, #f5f5f5);
		}

		html[data-theme="dark"] .report-wrapper .budget-gl-drillable--active:hover,
		html[data-theme-mode="dark"] .report-wrapper .budget-gl-drillable--active:hover {
			background-color: var(--gray-800, #2a2a2a);
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form {
			display: flex !important;
			flex-wrap: wrap !important;
			align-items: flex-end !important;
			align-content: flex-start !important;
			gap: 8px 16px !important;
			padding: 16px 32px 8px 32px !important;
			margin-left: 0 !important;
			margin-right: 0 !important;
			box-sizing: border-box !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .report-wrapper {
			width: 100%;
			max-width: 100%;
			box-sizing: border-box;
		}

		#page-query-report.budget-plan-vs-forecast-page .report-wrapper .datatable {
			width: 100%;
			max-width: 100%;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .form-group,
		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .frappe-control {
			margin: 0 !important;
			padding: 0 !important;
			float: none !important;
			flex: 0 0 auto !important;
			max-width: none !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-wide {
			width: 260px !important;
			min-width: 260px !important;
			max-width: 320px !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form .budget-report-filter-wide .multiselect-list,
		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form .budget-report-filter-wide .multiselect-list .form-control {
			width: 100% !important;
			min-width: 100% !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form .budget-report-filter-wide .status-text {
			max-width: 100%;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-company {
			width: 180px !important;
			min-width: 180px !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-period {
			width: 110px !important;
			min-width: 110px !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-select {
			width: auto !important;
			min-width: 140px !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-check {
			width: auto !important;
			min-width: auto !important;
			max-width: none !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-check .checkbox {
			margin: 0 !important;
			min-height: 28px !important;
			display: flex !important;
			align-items: center !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-check .checkbox label {
			margin: 0 !important;
			display: inline-flex !important;
			align-items: center !important;
			white-space: nowrap !important;
		}

		#page-query-report.budget-plan-vs-forecast-page .page-form.budget-report-filters-form > .budget-report-filter-check .label-area {
			white-space: nowrap !important;
			overflow: visible !important;
			text-overflow: clip !important;
		}

		.budget-plan-vs-forecast-page .budget-report-chart-container {
			margin: 0 0 12px 0;
			padding: 8px 0 0;
		}

		.budget-plan-vs-forecast-page .budget-report-chart {
			width: 100%;
			height: 320px;
			min-height: 240px;
		}
	`;

	var styleSheet = document.createElement("style");
	styleSheet.textContent = styles;
	document.head.appendChild(styleSheet);
};
