const FINANCIAL_METRICS_API =
    "dinext_projects_pl.dinext_projects_pl.financial_metrics.service.get_project_financial_metrics";

function init_financial_metrics_reporting_date(frm) {
    if (frm._financial_metrics_reporting_date === undefined) {
        frm._financial_metrics_reporting_date =
            frm.doc.custom_metrics_reporting_date || frappe.datetime.get_today();
    }

    if (frm.get_field?.("custom_metrics_reporting_date")) {
        frm.set_df_property("custom_metrics_reporting_date", "hidden", 1);
    }
}

function get_financial_metrics_wrapper(frm) {
    const field = frm?.get_field && frm.get_field("custom_metrics");
    if (!field) {
        console.warn("Project.custom_metrics field is not available");
        return null;
    }

    const fieldWrapper = $(field.wrapper || field.$wrapper);
    if (fieldWrapper.length) {
        const $inner = fieldWrapper.find("div[data-fieldname='custom_metrics']").first();
        frm.$financial_metrics = $inner.length ? $inner : fieldWrapper;
    } else {
        frm.$financial_metrics = $(frm.wrapper).find("div[data-fieldname='custom_metrics']").first();
    }

    if (!frm.$financial_metrics || !frm.$financial_metrics.length) {
        console.warn("Project.custom_metrics render target is not available");
        return null;
    }

    frm.$financial_metrics.show();
    return frm.$financial_metrics;
}

function ensure_financial_metrics_section_open(frm) {
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length) {
        return;
    }

    const $section = $wrapper.closest(".form-section");
    if (!$section.length) {
        return;
    }

    $section.find(".section-head.collapsible").removeClass("collapsed");
    $section.find(".collapse-indicator use").attr("href", "#es-line-up");
    $section.find(".section-body").removeClass("hide").show();
}

function format_financial_metric_value(value, kind) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }

    if (kind === "ratio") {
        return Number(value).toFixed(3);
    }

    return frappe.format(value, { fieldtype: "Currency" });
}

function build_financial_metric_tooltip(metric) {
    const parts = [];

    if (metric?.formula) {
        parts.push(__(metric.formula));
    }

    if (metric?.interpretation) {
        parts.push(__(metric.interpretation));
    }

    return parts.join("\n");
}

function fetch_financial_metrics(frm) {
    if (!frm || frm.is_new?.() || !frm.doc?.name) {
        return Promise.resolve({
            ready: false,
            emptyMessage: __("Financial metrics will be available after P&L data is loaded."),
            note: __("Metrics are calculated as of the selected report date."),
            warning: null,
            tracks: [],
        });
    }

    const reportingDate = frm._financial_metrics_reporting_date;
    const inflightKey = `${frm.doc.name}::${reportingDate || ""}`;
    if (frm._financial_metrics_inflight && frm._financial_metrics_inflight_key === inflightKey) {
        return frm._financial_metrics_inflight;
    }

    const requestId = (frm._financial_metrics_request_id || 0) + 1;
    frm._financial_metrics_request_id = requestId;

    // frappe.call returns a thenable (not always a native Promise) — wrap for .finally.
    const request = Promise.resolve(
        frappe.call({
            method: FINANCIAL_METRICS_API,
            args: {
                project: frm.doc.name,
                reporting_date: reportingDate,
            },
        })
    )
        .then((response) => {
            if (frm._financial_metrics_request_id !== requestId) {
                return null;
            }

            return response.message || {
                ready: false,
                emptyMessage: __("No data to calculate financial metrics."),
                note: __("Metrics are calculated as of the selected report date."),
                warning: null,
                tracks: [],
            };
        })
        .catch(() => {
            if (frm._financial_metrics_request_id !== requestId) {
                return null;
            }

            return {
                ready: false,
                emptyMessage: __("Failed to load financial metrics."),
                note: __("Metrics are calculated as of the selected report date."),
                warning: null,
                tracks: [],
            };
        })
        .finally(() => {
            if (frm._financial_metrics_inflight_key === inflightKey) {
                frm._financial_metrics_inflight = null;
                frm._financial_metrics_inflight_key = null;
            }
        });

    frm._financial_metrics_inflight_key = inflightKey;
    frm._financial_metrics_inflight = request;
    return request;
}

function render_financial_metrics_content(frm, metricsData) {
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length || !metricsData) {
        return;
    }

    ensure_financial_metrics_section_open(frm);
    $wrapper.empty();
    $wrapper.addClass("project-financial-metrics");

    const $section = $('<section class="evm-metrics-section"></section>');
    const $header = $(`
        <div class="evm-metrics-header">
            <div>
                <h3 class="evm-metrics-title">${__("Financial Metrics")}</h3>
                <div class="evm-metrics-note">${frappe.utils.escape_html(metricsData.note || "")}</div>
            </div>
            <div class="evm-metrics-reporting-date"></div>
        </div>
    `);
    $section.append($header);

    frappe.ui.form.make_control({
        parent: $header.find(".evm-metrics-reporting-date"),
        df: {
            fieldtype: "Date",
            fieldname: "financial_metrics_reporting_date",
            label: __("Metrics Report Date"),
            change() {
                const nextValue = this.get_value() || frappe.datetime.get_today();
                if (nextValue === frm._financial_metrics_reporting_date) {
                    return;
                }
                frm._financial_metrics_reporting_date = nextValue;
                render_financial_metrics(frm);
            },
        },
        value: frm._financial_metrics_reporting_date,
        render_input: true,
    });

    if (metricsData.warning) {
        $section.append(
            `<div class="evm-metrics-warning">${frappe.utils.escape_html(metricsData.warning)}</div>`
        );
    }

    if (!metricsData.ready) {
        $section.append(
            `<div class="evm-metrics-empty">${frappe.utils.escape_html(metricsData.emptyMessage || __("No data to calculate financial metrics."))}</div>`
        );
        $wrapper.append($section);
        return;
    }

    const $tracks = $('<div class="evm-metrics-tracks"></div>');

    metricsData.tracks.forEach((track) => {
        const $track = $(`
            <div class="evm-track-card" data-track="${frappe.utils.escape_html(track.key)}">
                <div class="evm-track-title">${frappe.utils.escape_html(track.label)}</div>
            </div>
        `);

        track.groups.forEach((group) => {
            const $group = $(`
                <div class="evm-metric-group" data-group="${frappe.utils.escape_html(group.key)}">
                    <div class="evm-metric-group-title">${frappe.utils.escape_html(group.label)}</div>
                </div>
            `);

            group.metrics.forEach((metric) => {
                const metricValue = format_financial_metric_value(metric.value, metric.kind);
                const tooltipText = build_financial_metric_tooltip(metric);
                const helpTitle = frappe.utils.escape_html(tooltipText).replace(/"/g, "&quot;");
                const label = frappe.utils.escape_html(metric.label);
                const shortName = frappe.utils.escape_html(metric.shortName || "");
                const statusClass = metric.status ? ` is-${metric.status}` : "";

                $group.append(`
                    <div class="evm-metric-row${statusClass}">
                        <div class="evm-metric-label-wrap">
                            <span class="evm-metric-label">
                                <span class="evm-metric-code">${label}</span>
                                <span class="evm-metric-short-name">${shortName}</span>
                            </span>
                            <span class="evm-metric-help" title="${helpTitle}" aria-label="${helpTitle}">i</span>
                        </div>
                        <div class="evm-metric-value">${metricValue}</div>
                    </div>
                `);
            });

            $track.append($group);
        });

        $tracks.append($track);
    });

    $section.append($tracks);
    $wrapper.append($section);
}

function render_financial_metrics(frm) {
    if (!frm) {
        return;
    }

    if (frm.get_field?.("custom_financial_metrics")?.df?.hidden) {
        return;
    }

    init_financial_metrics_reporting_date(frm);
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length) {
        return;
    }

    $wrapper.empty();
    $wrapper.addClass("project-financial-metrics");
    $wrapper.html(
        `<div class="evm-metrics-empty">${frappe.utils.escape_html(__("Loading financial metrics..."))}</div>`
    );

    return fetch_financial_metrics(frm).then((metricsData) => {
        if (!metricsData) {
            return;
        }
        render_financial_metrics_content(frm, metricsData);
    });
}

function build_financial_metrics(frm) {
    return fetch_financial_metrics(frm);
}

globalThis.build_financial_metrics = build_financial_metrics;
globalThis.render_financial_metrics = render_financial_metrics;
