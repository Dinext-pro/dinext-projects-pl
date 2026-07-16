function applyPLStyle() {
    // Your CSS as text 
    var pl_styles = `
        .budget-container {
            & {
                max-width: 100% !important;
            }
            & .budget-controls {
                display: inline-flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px;
                width: 100%;
                margin-bottom: 0.5rem;
            }
            & .budget-controls .pl-forecast-dropdown-wrapper {
                margin-left: auto;
            }
            & .budget-controls .frappe-control {
                flex: 0 1 150px;
                margin-bottom: 0px;
            }
            & .budget-table.dinext-table {
                margin-top: 0.25rem;
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
        #project-custom_pl div[data-fieldname='custom_pl_chart'].pl-chart-wrapper,
        #project-custom_pl div[data-fieldname='custom_pl_chart'] .pl-chart-container,
        .pl-chart-wrapper {
            width: 100%;
            max-width: 100%;
        }

        .pl-chart-container {
            width: 100%;
            min-height: 360px;
            height: 360px;
            overflow: visible;
            background: transparent;
        }

        .pl-chart-wrapper.pl-chart-expanded .pl-chart-container {
            min-height: 440px;
            height: 440px;
        }

        .pl-chart-error {
            padding: 24px;
            color: var(--red-500, #c0392b);
        }

        .project-financial-metrics {
            margin: 1rem 0 1.25rem;
        }

        .project-financial-metrics .evm-metrics-section {
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-md);
            background: var(--card-bg);
            padding: 1rem;
        }

        .project-financial-metrics .evm-metrics-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 1rem;
            margin-bottom: 0.75rem;
        }

        .project-financial-metrics .evm-metrics-reporting-date {
            flex: 0 0 auto;
            min-width: 11rem;
        }

        .project-financial-metrics .evm-metrics-reporting-date .form-group {
            margin-bottom: 0;
        }

        .project-financial-metrics .evm-metrics-title {
            margin: 0;
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-color);
        }

        .project-financial-metrics .evm-metrics-note {
            margin-top: 0.25rem;
            font-size: 12px;
            color: var(--text-muted);
        }

        .project-financial-metrics .evm-metrics-warning,
        .project-financial-metrics .evm-metrics-empty {
            margin-top: 0.75rem;
            padding: 0.75rem 0.875rem;
            border-radius: var(--border-radius-md);
            background: var(--bg-light-gray);
            color: var(--text-muted);
            font-size: 13px;
        }

        .project-financial-metrics .evm-metrics-warning {
            border: 1px solid var(--warning-border);
            color: var(--warning-text, var(--text-color));
        }

        .project-financial-metrics .evm-metrics-tracks {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1rem;
            align-items: start;
            margin-top: 0.75rem;
        }

        .project-financial-metrics .evm-track-card {
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-md);
            background: var(--subtle-fg);
            padding: 0.875rem;
        }

        .project-financial-metrics .evm-track-title {
            margin-bottom: 0.75rem;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-color);
        }

        .project-financial-metrics .evm-metric-group + .evm-metric-group {
            margin-top: 0.875rem;
        }

        .project-financial-metrics .evm-metric-group-title {
            margin-bottom: 0.375rem;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            color: var(--text-muted);
        }

        .project-financial-metrics .evm-metric-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            padding: 0.375rem 0;
            border-top: 1px solid var(--border-color);
        }

        .project-financial-metrics .evm-metric-group .evm-metric-row:first-of-type {
            border-top: 0;
        }

        .project-financial-metrics .evm-metric-label-wrap {
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            min-width: 0;
        }

        .project-financial-metrics .evm-metric-label {
            display: inline-flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0.25rem;
            color: var(--text-color);
            font-size: 13px;
            font-weight: 500;
        }

        .project-financial-metrics .evm-metric-code {
            font-weight: 600;
            letter-spacing: 0.01em;
        }

        .project-financial-metrics .evm-metric-short-name {
            color: var(--text-muted);
            font-weight: 400;
        }

        .project-financial-metrics .evm-metric-help {
            display: inline-flex;
            justify-content: center;
            align-items: center;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border: 1px solid var(--border-color);
            color: var(--text-muted);
            font-size: 10px;
            line-height: 1;
            cursor: help;
            user-select: none;
            background: var(--card-bg);
        }

        .project-financial-metrics .evm-metric-value {
            white-space: nowrap;
            font-feature-settings: "tnum";
            font-size: 13px;
            font-weight: 600;
            color: var(--text-color);
            text-align: right;
        }

        .project-financial-metrics .evm-metric-row.is-good .evm-metric-value {
            color: var(--green-600);
        }

        .project-financial-metrics .evm-metric-row.is-bad .evm-metric-value {
            color: var(--red-600);
        }

        @media (max-width: 991px) {
            .project-financial-metrics .evm-metrics-tracks {
                grid-template-columns: 1fr;
            }
        }
    `;

    if (frappe?.dom?.set_style) {
        frappe.dom.set_style(pl_styles);
        return;
    }

    var styleSheet = document.createElement("style");
    styleSheet.textContent = pl_styles;
    document.head.appendChild(styleSheet);
}

applyPLStyle();