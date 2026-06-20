const DINEXT_PROJECT_PL_EVM_METRIC_GROUPS = [
    {
        key: "base",
        label: __("Базовые"),
        metrics: [
            {
                key: "BAC",
                label: "BAC",
                kind: "currency",
                shortName: __("Бюджет по завершению"),
                formula: __("Складываем все утвержденные плановые суммы по этому направлению за весь срок проекта."),
                interpretation: __("Это весь утвержденный бюджет проекта по выбранному направлению до самого завершения."),
            },
            {
                key: "PV",
                label: "PV",
                kind: "currency",
                shortName: __("Плановый объем"),
                formula: __("Берем план на дату отчета: прошлые месяцы учитываем полностью, текущий месяц - только по уже прошедшим дням."),
                interpretation: __("Показывает, сколько по плану должно быть выполнено и освоено к выбранной дате."),
            },
            {
                key: "EV",
                label: "EV",
                kind: "currency",
                shortName: __("Освоенный объем"),
                formula: __("Берем общий бюджет и умножаем его на текущий процент готовности проекта."),
                interpretation: __("Показывает стоимость того результата, который проект уже реально должен был дать на эту дату."),
            },
            {
                key: "AC",
                label: "AC",
                kind: "currency",
                shortName: __("Фактическая стоимость"),
                formula: __("Складываем все фактические суммы на дату отчета: прошлые месяцы полностью, текущий месяц - по уже прошедшим дням."),
                interpretation: __("Показывает, сколько денег уже реально потрачено или отражено по факту к этой дате."),
            },
        ],
    },
    {
        key: "variance",
        label: __("Отклонения"),
        metrics: [
            {
                key: "CV",
                label: "CV",
                kind: "currency",
                shortName: __("Отклонение по стоимости"),
                formula: __("Из стоимости уже выполненного результата вычитаем фактические затраты на него."),
                interpretation: __(
                    "Если значение меньше нуля, денег потрачено больше, чем стоит полученный результат. Если больше нуля, есть экономия."
                ),
            },
            {
                key: "SV",
                label: "SV",
                kind: "currency",
                shortName: __("Отклонение по срокам"),
                formula: __("Из стоимости уже выполненного результата вычитаем то, что по плану должно было быть сделано к этой дате."),
                interpretation: __("Если значение меньше нуля, проект отстает от плана. Если больше нуля, проект идет с опережением."),
            },
        ],
    },
    {
        key: "indices",
        label: __("Индексы"),
        metrics: [
            {
                key: "CPI",
                label: "CPI",
                kind: "ratio",
                shortName: __("Индекс выполнения стоимости"),
                formula: __("Делим стоимость уже выполненного результата на фактические затраты."),
                interpretation: __(
                    "Показывает, сколько результата проект получает на каждую потраченную денежную единицу. Значение больше единицы считается хорошим."
                ),
            },
            {
                key: "SPI",
                label: "SPI",
                kind: "ratio",
                shortName: __("Индекс выполнения сроков"),
                formula: __("Делим стоимость уже выполненного результата на то, что по плану должно было быть сделано к этой дате."),
                interpretation: __("Показывает, насколько фактический прогресс соответствует плану. Значение больше единицы считается хорошим."),
            },
        ],
    },
    {
        key: "forecast",
        label: __("Прогнозные"),
        metrics: [
            {
                key: "EAC",
                label: "EAC",
                kind: "currency",
                shortName: __("Прогноз по завершении"),
                formula: __("Берем уже накопленный факт и добавляем оставшуюся часть бюджета с поправкой на текущую эффективность по деньгам и срокам."),
                interpretation: __(
                    "Показывает, во сколько обойдется это направление проекта к завершению, если текущая динамика не изменится."
                ),
            },
            {
                key: "ETC",
                label: "ETC",
                kind: "currency",
                shortName: __("До завершения"),
                formula: __("Из прогноза на завершение вычитаем то, что уже накоплено по факту."),
                interpretation: __("Показывает, сколько еще денег потребуется до завершения при текущем прогнозе."),
            },
            {
                key: "VAC",
                label: "VAC",
                kind: "currency",
                shortName: __("Отклонение по завершении"),
                formula: __("Из общего утвержденного бюджета вычитаем прогноз итоговой суммы."),
                interpretation: __("Если значение меньше нуля, к завершению ожидается перерасход. Если больше нуля, в бюджете остается запас."),
            },
        ],
    },
    {
        key: "efficiency",
        label: __("Требуемая эффективность"),
        metrics: [
            {
                key: "TCPI",
                label: "TCPI",
                kind: "ratio",
                shortName: __("Требуемая эффективность"),
                formula: __("Сравниваем оставшийся объем работы по бюджету с тем, сколько еще можно потратить без выхода за общий бюджет."),
                interpretation: __(
                    "Показывает, насколько эффективно нужно работать дальше, чтобы уложиться в общий бюджет. Значение меньше или равно единице считается достижимым."
                ),
            },
        ],
    },
];

function init_financial_metrics_reporting_date(frm) {
    if (frm._financial_metrics_reporting_date === undefined) {
        frm._financial_metrics_reporting_date =
            frm.doc.custom_metrics_reporting_date || frappe.datetime.get_today();
    }

    if (frm.get_field?.("custom_metrics_reporting_date")) {
        frm.set_df_property("custom_metrics_reporting_date", "hidden", 1);
    }
}

function get_financial_metric_roots(frm, trackType) {
    if (!frm || !frm.aggregatedBudget) {
        return [];
    }

    return Object.values(frm.aggregatedBudget).filter(
        (row) => !row.parent_account && !row.task && row.type === trackType
    );
}

function get_financial_metric_bucket_value(frm, row, period, valueKey) {
    if (!frm || !row || !period) {
        return 0;
    }

    const bucket = Array.isArray(row.dimension_data) && row.dimension_data.length ? row.dimension_data[0] : {};
    const fieldname = `${valueKey}_${period.year}_${period.month}`;
    let value = Number(bucket[fieldname]) || 0;

    if (!value) {
        value = get_child_budget_sum(row.value, "", [], period, frm.aggregatedBudget, valueKey);
    }

    return Number(value) || 0;
}

function get_financial_metric_track_period_totals(frm, period, trackType) {
    const roots = get_financial_metric_roots(frm, trackType);
    let plan = 0;
    let fact = 0;

    roots.forEach((row) => {
        plan += get_financial_metric_bucket_value(frm, row, period, "plan");
        fact += get_financial_metric_bucket_value(frm, row, period, "fact");
    });

    return { plan, fact };
}

function get_financial_metrics_reporting_date(frm) {
    const todayString = frappe.datetime.get_today();
    const rawValue = frm?._financial_metrics_reporting_date || todayString;

    return {
        date: frappe.datetime.str_to_obj(rawValue),
        value: rawValue,
        usedDefault: !frm?._financial_metrics_reporting_date,
    };
}

function compare_financial_metric_period_to_date(period, reportingDate) {
    const reportingYear = reportingDate.getFullYear();
    const reportingMonth = reportingDate.getMonth() + 1;

    if (period.year < reportingYear || (period.year === reportingYear && period.month < reportingMonth)) {
        return -1;
    }

    if (period.year === reportingYear && period.month === reportingMonth) {
        return 0;
    }

    return 1;
}

function get_financial_metric_days_in_month(year, month) {
    return new Date(year, month, 0).getDate();
}

function get_financial_metric_plan_factor(period, reportingDate) {
    const comparison = compare_financial_metric_period_to_date(period, reportingDate);
    if (comparison < 0) {
        return 1;
    }
    if (comparison > 0) {
        return 0;
    }

    return reportingDate.getDate() / get_financial_metric_days_in_month(period.year, period.month);
}

function get_financial_metric_actual_factor(period, reportingDate) {
    const comparison = compare_financial_metric_period_to_date(period, reportingDate);
    if (comparison < 0) {
        return 1;
    }
    if (comparison > 0) {
        return 0;
    }

    return reportingDate.getDate() / get_financial_metric_days_in_month(period.year, period.month);
}

function safe_financial_metric_division(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) {
        return null;
    }

    return numerator / denominator;
}

function get_financial_metric_status(metricKey, value, track) {
    if (!Number.isFinite(value)) {
        return "neutral";
    }

    if (track === "Income") {
        return "neutral";
    }

    switch (metricKey) {
        case "CV":
        case "SV":
        case "VAC":
            return value >= 0 ? "good" : "bad";
        case "CPI":
        case "SPI":
            return value >= 1 ? "good" : "bad";
        case "TCPI":
            return value <= 1 ? "good" : "bad";
        default:
            return "neutral";
    }
}

function build_financial_metric_groups(trackLabel, values) {
    return DINEXT_PROJECT_PL_EVM_METRIC_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        metrics: group.metrics.map((metric) => {
            const value = values[metric.key];
            return {
                key: metric.key,
                label: metric.label,
                kind: metric.kind,
                shortName: metric.shortName,
                formula: metric.formula,
                interpretation: metric.interpretation,
                value,
                status: get_financial_metric_status(metric.key, value, trackLabel),
            };
        }),
    }));
}

function build_financial_metrics_track(frm, trackType, reportingDate, progressPercent) {
    const periods = get_budget_display_periods(frm, "month");
    let BAC = 0;
    let PV = 0;
    let AC = 0;

    periods.forEach((period) => {
        const periodTotals = get_financial_metric_track_period_totals(frm, period, trackType);
        BAC += periodTotals.plan;
        PV += periodTotals.plan * get_financial_metric_plan_factor(period, reportingDate);
        AC += periodTotals.fact * get_financial_metric_actual_factor(period, reportingDate);
    });

    const EV = BAC * (progressPercent / 100);
    const CV = EV - AC;
    const SV = EV - PV;
    const CPI = safe_financial_metric_division(EV, AC);
    const SPI = safe_financial_metric_division(EV, PV);
    const EAC =
        Number.isFinite(CPI) && Number.isFinite(SPI) && CPI && SPI
            ? AC + (BAC - EV) / (CPI * SPI)
            : null;
    const ETC = Number.isFinite(EAC) ? EAC - AC : null;
    const VAC = Number.isFinite(EAC) ? BAC - EAC : null;
    const TCPI = BAC !== AC ? safe_financial_metric_division(BAC - EV, BAC - AC) : null;

    const trackLabel = trackType === "Income" ? __("Доходы") : __("Расходы");

    return {
        key: trackType.toLowerCase(),
        label: trackLabel,
        values: { BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC, TCPI },
        groups: build_financial_metric_groups(trackLabel, { BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, ETC, VAC, TCPI }),
    };
}

function build_financial_metrics(frm) {
    if (!frm || !frm.aggregatedBudget) {
        return {
            ready: false,
            emptyMessage: __("Финансовые метрики будут доступны после загрузки данных P&L."),
            note: __("Метрики рассчитываются на выбранную отчетную дату."),
            warning: null,
            tracks: [],
        };
    }

    const reportingDateInfo = get_financial_metrics_reporting_date(frm);
    const reportingDate = reportingDateInfo.date;
    const progressPercent = Number(frm.doc.percent_complete) || 0;
    const warnings = [];

    if (progressPercent <= 0) {
        warnings.push(
            __("Поле Project.percent_complete не заполнено или равно 0. EV и производные метрики будут показаны как нулевые или недоступные.")
        );
    }

    return {
        ready: true,
        note: __(
            "Метрики рассчитываются на отчетную дату {0}. План и факт текущего месяца учитываются пропорционально дням месяца.",
            [frappe.datetime.str_to_user(reportingDateInfo.value)]
        ),
        warning: warnings.length ? warnings.join(" ") : null,
        reportingDate,
        progressPercent,
        tracks: [
            build_financial_metrics_track(frm, "Income", reportingDate, progressPercent),
            build_financial_metrics_track(frm, "Expense", reportingDate, progressPercent),
        ],
    };
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
    if (!Number.isFinite(value)) {
        return "—";
    }

    if (kind === "ratio") {
        return value.toFixed(3);
    }

    return frappe.format(value, { fieldtype: "Currency" });
}

function build_financial_metric_tooltip(metric) {
    const parts = [];

    if (metric?.formula) {
        parts.push(__( metric.formula ));
    }

    if (metric?.interpretation) {
        parts.push(__( metric.interpretation ));
    }

    return parts.join("\n");
}

function render_financial_metrics(frm) {
    if (!frm) {
        return;
    }

    init_financial_metrics_reporting_date(frm);
    const $wrapper = get_financial_metrics_wrapper(frm);
    if (!$wrapper || !$wrapper.length || typeof build_financial_metrics !== "function") {
        return;
    }

    const metricsData = build_financial_metrics(frm);
    ensure_financial_metrics_section_open(frm);
    $wrapper.empty();
    $wrapper.addClass("project-financial-metrics");

    const $section = $('<section class="evm-metrics-section"></section>');
    const $header = $(`
        <div class="evm-metrics-header">
            <div>
                <h3 class="evm-metrics-title">${__("Финансовые метрики")}</h3>
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
            label: __("Отчетная дата метрик"),
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
            `<div class="evm-metrics-empty">${frappe.utils.escape_html(metricsData.emptyMessage || __("Нет данных для расчета финансовых метрик."))}</div>`
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

globalThis.build_financial_metrics = build_financial_metrics;
globalThis.render_financial_metrics = render_financial_metrics;
