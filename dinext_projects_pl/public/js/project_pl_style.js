function applyPLStyle() {
    // Your CSS as text 
    var pl_styles = `
        .budget-container {
            & {
                max-width: 100% !important;;
            }
            & .budget-table .datatable {
                margin-top: 1rem;
            }
            & .budget-controls {
                display: inline-flex;
                width: 100%;
            }
            & .budget-controls .pl-forecast-dropdown-wrapper {
                margin-left: auto;
            }
            & .budget-controls .frappe-control {
                flex: 0 1 150px;
            }
            & .budget-group-header {
                display: flex; 
                justify-content: space-around;
            }
            & .budget-group-header > span {
                width: 33.33%;
                font-size: 10px;
                display: flex;
                justify-content: center;
            }
            & .budget-group {
                display: flex;
                flex-direction: row;
                flex-wrap: nowrap;
                justify-content: space-around;
            }
            & .budget-group span {
                font-size: smaller;
            }
            & .budget-table .datatable .dt-row.dt-row-header, 
            & .budget-table .datatable .dt-cell.dt-cell--header {
                height: auto;
                text-align: center;
                display: flex;
            }
            & .budget-table .dt-cell {
                /*border: 1px solid #d1d8dd;*/
                position: static;
            }
            & .budget-table .datatable .dt-cell--focus .dt-cell__content {
                border-color: var(--gray-200);
            }
            & .budget-table .datatable .dt-scrollable {
                max-height: max(calc(100vh - 400px),350px);
            }
            & .budget-table .datatable .dt-fit-height {
                min-height: auto !important;
            }
            & .budget-table .datatable .dt-header .dt-cell--header .dt-cell__content {
                font-weight: 600;    
                margin: auto;
            }
            & .dt-cell .profit, .dt-cell .profitability {
                display: block;
                text-align: right;
            }
            & .budget-group > div {
                min-width: 3em;
                text-align: center;
            }
            & .budget-group[data-is-past="true"] .bg-group-actual:not(.zero):has(.readonly-fact) {
                cursor: pointer;
            }
            & .budget-group > div.zero {
                color: var(--bg-dark-gray);
            }
            & .editable-forecast {
                cursor: text;
                isplay: block;
            }
            & .bg-edit-input {
                text-align: center;
                width: 4em;
                outline: none;
                background-color: transparent;
                border: 0px;
                width: 100%;
            }
            & .bg-edit-input.error {
                background-color: var(--error-border);
            }
            & .delete-dimension-btn {
                padding: 0px!important;
                border-radius: 50%;
                box-sizing: border-box;
                line-height: 0;
                margin-left: 0.5rem;
            }
            & .dt-cell__content {
                font-feature-settings: "tnum";
                width: 180px;
                padding: 2px;
            }
            & .budget-table .dt-cell--col-0, 
            & .budget-table .dt-cell__content dt-cell__content--header-0,
            & .budget-table .dt-cell--col-1, 
            & .budget-table .dt-cell__content dt-cell__content--header-1 {
                position: sticky;
                z-index: 1;
            } 
            /*Высота ячеек*/
            & .budget-table .datatable .dt-row, 
            & .budget-table .dt-cell__content,
            & .budget-table .dt-cell {
                height: auto !important;
            }
            & .budget-table .dt-row.vrow {
                /*position: static !important;*/
                width: fit-content;
            }
            & .new-dimension-select, 
            & .new-dimension-select option {
                width: 100%;
            }
        }
        @media (min-width: 576px) {
            #project-custom_pl .report-summary {
                flex-wrap: nowrap;
            }
            #project-custom_pl .report-summary .summary-item,
            #project-custom_pl .report-summary .summary-separator .summary-value {
                margin: 0px;
            }
            #project-custom_pl div[data-fieldname='periodicity'],
            #project-custom_pl div[data-fieldname='accumulated_values'] span.label-area {
                min-width: 100%;
            }
            #project-custom_pl button > .icon{
            margin: 0 10px 0 0;
            }
        }
        .pl-chart-wrapper {
            & .dataset-line.dataset-2 .line-graph-path,
            & .dataset-line.dataset-2 .region-fill,
            & .dataset-line.dataset-4 .line-graph-path,
            & .dataset-line.dataset-4 .region-fill,
            & .dataset-line.dataset-5 .line-graph-path,
            & .dataset-line.dataset-5 .region-fill{
                display: none;
            }
            & .dataset-line.dataset-3 circle,
            & .dataset-line.dataset-6 circle,
            & .dataset-line.dataset-7 circle{
                display: none;
            }
        }

        /* Добавляем отступ для оси Y */
        .pl-chart-container svg .y.axis .tick text {
            transform: translateX(15px) !important;
        }

        .pl-chart-container {
            overflow: visible !important;
        }

        .pl-chart-container svg {
            overflow: visible !important;
        }
    `;

    var styleSheet = document.createElement("style");
    styleSheet.textContent = pl_styles;
    document.head.appendChild(styleSheet);
}

applyPLStyle();