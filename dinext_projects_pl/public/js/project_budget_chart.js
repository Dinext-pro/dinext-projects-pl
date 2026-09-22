const ECHARTS_ASSET = "/assets/dinext_common/js/echarts.min.js";
const LARGE_DATA_THRESHOLD = 1500;

function pl_chart_debug_enabled() {
    return Boolean(frappe?.boot?.developer_mode);
}

const PL_CHART_COLORS_HIDE_PLAN = ["#007a33", "#cc3333", "#ff9933", "#00509e"];
const PL_CHART_COLORS_SHOW_PLAN = [
    "#66b3a1",
    "#007a33",
    "#ff6666",
    "#cc3333",
    "#ffcc66",
    "#ff9933",
    "#007acc",
    "#00509e",
];

let _plChartThemeObserver = null;
let _plChartActiveFrm = null;
let _plChartResizeObserver = null;
let _plChartResizeObserverTarget = null;

function load_pl_echarts() {
    if (window.echarts) {
        return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
        frappe.require([ECHARTS_ASSET], function () {
            if (window.echarts) {
                resolve();
            } else {
                reject(new Error("Failed to load ECharts"));
            }
        });
    });
}

function parse_pl_chart_rgb(color) {
    if (!color) {
        return null;
    }

    const value = String(color).trim();
    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(",").map((part) => parseFloat(part.trim()));
        if (parts.length >= 3) {
            return { r: parts[0], g: parts[1], b: parts[2] };
        }
    }

    const hexMatch = value.match(/^#([0-9a-f]{3,8})$/i);
    if (!hexMatch) {
        return null;
    }

    let hex = hexMatch[1];
    if (hex.length === 3) {
        hex = hex
            .split("")
            .map((char) => char + char)
            .join("");
    }

    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
    };
}

function is_pl_chart_color_dark(color) {
    const rgb = parse_pl_chart_rgb(color);
    if (!rgb) {
        return false;
    }

    const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    return luminance < 128;
}

function is_pl_chart_dark_theme() {
    const root = document.documentElement;
    const mode = root.getAttribute("data-theme-mode");
    if (mode === "dark") {
        return true;
    }
    if (mode === "light") {
        return false;
    }

    const theme = root.getAttribute("data-theme");
    if (theme === "dark") {
        return true;
    }
    if (theme === "light") {
        return false;
    }

    const bodyStyle = getComputedStyle(document.body);
    if (is_pl_chart_color_dark(bodyStyle.backgroundColor)) {
        return true;
    }
    if (is_pl_chart_color_dark(bodyStyle.color)) {
        return false;
    }

    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function get_pl_chart_theme_colors() {
    const isDark = is_pl_chart_dark_theme();
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const fallbackText = isDark ? "#e2e2e2" : "#333333";
    const fallbackMuted = isDark ? "#a3a3a3" : "#748094";
    const fallbackBorder = isDark ? "#3a3a3a" : "#d1d8dd";
    const fallbackBg = isDark ? "#1e1e1e" : "#ffffff";
    const fallbackGridLine = isDark ? "rgba(255, 255, 255, 0.08)" : "#e8e8e8";

    const text = bodyStyle.color || rootStyle.getPropertyValue("--text-color").trim() || fallbackText;
    const axisLabel = isDark
        ? text
        : rootStyle.getPropertyValue("--text-muted").trim() || bodyStyle.color || fallbackMuted;

    return {
        text,
        muted: isDark ? axisLabel : rootStyle.getPropertyValue("--text-muted").trim() || fallbackMuted,
        axisLabel,
        border: isDark ? fallbackBorder : rootStyle.getPropertyValue("--border-color").trim() || fallbackBorder,
        gridLine: isDark
            ? fallbackGridLine
            : rootStyle.getPropertyValue("--border-color").trim() || fallbackGridLine,
        bg: rootStyle.getPropertyValue("--card-bg").trim() || fallbackBg,
    };
}

function get_pl_chart_currency_docfield(frm) {
    const docfield = { fieldtype: "Currency" };

    if (frm?.doc?.company) {
        docfield.options = "Company:company:default_currency";
    }

    return docfield;
}

function format_pl_chart_axis_value(value) {
    if (typeof frappe?.utils?.format_chart_axis_number === "function") {
        return frappe.utils.format_chart_axis_number(value);
    }

    return frappe.format(value, { fieldtype: "Currency" });
}

function format_pl_chart_tooltip_value(value, frm) {
    return frappe.format(
        value,
        get_pl_chart_currency_docfield(frm),
        { only_value: true },
        frm?.doc
    );
}

function get_pl_chart_view_label(frm) {
    let view = __("fact/forecast");
    if (frm.budget_view_options == __("Forecast only")) {
        view = __("forecast");
    } else if (
        frm.budget_view_options == __("Fact only") ||
        frm.budget_view_options == __("Actual only")
    ) {
        view = __("fact");
    }
    return view;
}

function is_pl_chart_expanded(frm) {
    return Boolean(frm?.pl_chart_expanded);
}

function toggle_pl_chart_expanded(frm) {
    if (!frm) {
        return;
    }

    frm.pl_chart_expanded = !is_pl_chart_expanded(frm);

    if (typeof globalThis.render_pl_chart_impl === "function") {
        globalThis.render_pl_chart_impl(frm, false);
    }
}

function build_pl_chart_toolbox(themeColors, frm) {
    const projectName = frm?.doc?.name;

    return {
        right: 8,
        top: 4,
        itemSize: 16,
        iconStyle: {
            borderColor: themeColors.muted,
        },
        feature: {
            myToggleExpandedMetrics: {
                show: !frm?.hide_pl_chart_expanded_toggle,
                title: is_pl_chart_expanded(frm)
                    ? __("Hide expanded metrics")
                    : __("Show expanded metrics"),
                icon: "path://M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z",
                onclick() {
                    toggle_pl_chart_expanded(frm);
                },
            },
            saveAsImage: {
                show: true,
                title: __("Save as Image"),
                name: projectName ? `project-pl-${projectName}` : "project-pl-chart",
                type: "png",
                pixelRatio: 2,
                backgroundColor: themeColors.bg,
            },
        },
    };
}

function build_pl_chart_data(frm) {
    if (pl_chart_debug_enabled()) {
        console.time("build_pl_chart_data");
    }
    // P3: chart only from project_budget (Sticky aggregatedBudget path removed).
    const fromV2 = window.ProjectBudget?.buildChartData?.(frm);
    if (fromV2) {
        if (pl_chart_debug_enabled()) {
            console.timeEnd("build_pl_chart_data");
        }
        return fromV2;
    }

    const periods = get_budget_display_periods(frm, "month");
    const labels = periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`);
    const zeros = periods.map(() => 0);
    if (pl_chart_debug_enabled()) {
        console.timeEnd("build_pl_chart_data");
    }
    return {
        labels,
        plan_income: zeros.slice(),
        actual_income: zeros.slice(),
        plan_expenses: zeros.slice(),
        actual_expenses: zeros.slice(),
        profit_plan: zeros.slice(),
        profit_actual: zeros.slice(),
        cumulative_profit_plan: zeros.slice(),
        cumulative_profit_actual: zeros.slice(),
        cumulative_income_plan: zeros.slice(),
        cumulative_income_actual: zeros.slice(),
        cumulative_expenses_plan: zeros.slice(),
        cumulative_expenses_actual: zeros.slice(),
        periods,
    };
}

function push_pl_chart_dataset(datasets, name, values, meta) {
    datasets.push({
        name,
        values,
        chartType: meta.chartType,
        plLayer: meta.plLayer,
        plSeriesKind: meta.plSeriesKind,
        plIsPlan: !!meta.plIsPlan,
    });
}

function get_pl_chart_data(frm) {
    let d = build_pl_chart_data(frm);
    let datasets = [];
    let view = get_pl_chart_view_label(frm);

    if (!frm.bg_hide_plan) {
        push_pl_chart_dataset(datasets, __("Income - plan"), d.plan_income, {
            chartType: "bar",
            plLayer: "bar",
            plSeriesKind: "income",
            plIsPlan: true,
        });
    }
    push_pl_chart_dataset(datasets, __("Income") + " - " + view, d.actual_income, {
        chartType: "bar",
        plLayer: "bar",
        plSeriesKind: "income",
    });
    if (!frm.bg_hide_plan) {
        push_pl_chart_dataset(datasets, __("Expenses - plan"), d.plan_expenses, {
            chartType: "bar",
            plLayer: "bar",
            plSeriesKind: "expense",
            plIsPlan: true,
        });
    }
    push_pl_chart_dataset(datasets, __("Expenses") + " - " + view, d.actual_expenses, {
        chartType: "bar",
        plLayer: "bar",
        plSeriesKind: "expense",
    });

    if (!frm.bg_hide_plan) {
        push_pl_chart_dataset(datasets, __("Profit - plan"), d.profit_plan, {
            chartType: "line",
            plLayer: "profit",
            plSeriesKind: "period_profit",
            plIsPlan: true,
        });
    }
    push_pl_chart_dataset(datasets, __("Profit") + " - " + view, d.profit_actual, {
        chartType: "line",
        plLayer: "profit",
        plSeriesKind: "period_profit",
    });

    if (!frm.bg_hide_plan) {
        push_pl_chart_dataset(datasets, __("Cumulative profit - plan"), d.cumulative_profit_plan, {
            chartType: "line",
            plLayer: "cumulative",
            plSeriesKind: "cumulative_profit",
            plIsPlan: true,
        });
    }
    push_pl_chart_dataset(
        datasets,
        __("Cumulative profit") + " - " + view,
        d.cumulative_profit_actual,
        {
            chartType: "line",
            plLayer: "cumulative",
            plSeriesKind: "cumulative_profit",
        }
    );

    if (is_pl_chart_expanded(frm)) {
        if (!frm.bg_hide_plan) {
            push_pl_chart_dataset(
                datasets,
                __("Cumulative income - plan"),
                d.cumulative_income_plan,
                {
                    chartType: "line",
                    plLayer: "cumulative",
                    plSeriesKind: "cumulative_income",
                    plIsPlan: true,
                }
            );
        }
        push_pl_chart_dataset(
            datasets,
            __("Cumulative income") + " - " + view,
            d.cumulative_income_actual,
            {
                chartType: "line",
                plLayer: "cumulative",
                plSeriesKind: "cumulative_income",
            }
        );
        if (!frm.bg_hide_plan) {
            push_pl_chart_dataset(
                datasets,
                __("Cumulative expenses - plan"),
                d.cumulative_expenses_plan,
                {
                    chartType: "line",
                    plLayer: "cumulative",
                    plSeriesKind: "cumulative_expense",
                    plIsPlan: true,
                }
            );
        }
        push_pl_chart_dataset(
            datasets,
            __("Cumulative expenses") + " - " + view,
            d.cumulative_expenses_actual,
            {
                chartType: "line",
                plLayer: "cumulative",
                plSeriesKind: "cumulative_expense",
            }
        );
    }

    let yMarkers = null;
    if (frm.bg_hide_plan) {
        let profit_plan = d.cumulative_profit_plan[d.cumulative_profit_plan.length - 1];
        if (profit_plan) {
            yMarkers = [
                {
                    label: __("Planned profit: ") + format_pl_chart_axis_value(profit_plan),
                    value: profit_plan,
                    options: { labelPos: "left" },
                },
            ];
        }
    }

    return {
        labels: d.labels,
        datasets,
        yMarkers,
        dataObj: d,
    };
}

function build_pl_bar_series(name, values, color, options = {}) {
    const { stack = null } = options;
    const series = {
        name,
        type: "bar",
        data: values,
        barGap: "20%",
        barCategoryGap: "40%",
        barMaxWidth: PL_CHART_BAR_MAX_WIDTH,
        itemStyle: { color },
        emphasis: { focus: "series" },
    };

    if (stack) {
        series.stack = stack;
        series.stackStrategy = "samesign";
    }

    return series;
}

const PL_CHART_BAR_STACK_ORDER = {
    plan: 0,
    actual: 1,
};

function get_pl_chart_bar_stack_group(dataset) {
    return dataset.plIsPlan ? "plan" : "actual";
}

function get_pl_chart_bar_series_role(dataset) {
    const kind = dataset.plSeriesKind;
    if (kind === "income" || kind === "cumulative_income") {
        return 0;
    }
    if (kind === "expense" || kind === "cumulative_expense") {
        return 1;
    }
    return 2;
}

function sort_pl_chart_bar_layer_items(items) {
    return items.slice().sort((left, right) => {
        const leftStack = get_pl_chart_bar_stack_group(left.dataset);
        const rightStack = get_pl_chart_bar_stack_group(right.dataset);
        if (leftStack !== rightStack) {
            return PL_CHART_BAR_STACK_ORDER[leftStack] - PL_CHART_BAR_STACK_ORDER[rightStack];
        }

        return (
            get_pl_chart_bar_series_role(left.dataset) -
            get_pl_chart_bar_series_role(right.dataset)
        );
    });
}

const PL_CHART_BAR_SLOT_FILL = 0.8;
const PL_CHART_BAR_MAX_WIDTH = 40;
const PL_CHART_PROFIT_LABEL_GAP = 6;
const PL_CHART_CURRENT_DATE_LINE_WIDTH = 1;

const PL_CHART_LAYER_ORDER = ["cumulative", "bar", "profit"];
const PL_CHART_LAYER_Z = {
    cumulative: 1,
    bar: 2,
    profit: 3,
};

function get_pl_profit_dash_geometry(frm, stackGroup, categoryBandWidth) {
    const stackCount = frm.bg_hide_plan ? 1 : 2;
    const slotIndex =
        stackGroup === "plan" ? 0 : frm.bg_hide_plan ? 0 : PL_CHART_BAR_STACK_ORDER.actual;
    const slotWidth = categoryBandWidth / stackCount;
    const offsetX = (slotIndex - (stackCount - 1) / 2) * slotWidth;
    const dashWidth = slotWidth * PL_CHART_BAR_SLOT_FILL;

    return {
        offsetX,
        dashWidth,
        slotWidth,
        stackCount,
        slotIndex,
    };
}

function get_pl_profit_label_layout(profitValue, lineY, gapPx = PL_CHART_PROFIT_LABEL_GAP) {
    if (profitValue < 0) {
        return {
            y: lineY + gapPx,
            verticalAlign: "top",
        };
    }

    return {
        y: lineY - gapPx,
        verticalAlign: "bottom",
    };
}

function get_pl_chart_dataset_layer(dataset) {
    if (dataset.plLayer) {
        return dataset.plLayer;
    }

    const kind = dataset.plSeriesKind;
    if (
        kind === "cumulative_profit" ||
        kind === "cumulative_income" ||
        kind === "cumulative_expense"
    ) {
        return "cumulative";
    }
    if (kind === "period_profit") {
        return "profit";
    }
    return "bar";
}

function is_pl_cumulative_profit_series(dataset) {
    return dataset.plSeriesKind === "cumulative_profit";
}

function is_pl_cumulative_volume_series(dataset) {
    return (
        dataset.plSeriesKind === "cumulative_income" ||
        dataset.plSeriesKind === "cumulative_expense"
    );
}

function get_pl_chart_dataset_color(dataset, index, palette, frm) {
    const kind = dataset.plSeriesKind;
    const hidePlan = frm.bg_hide_plan;

    if (kind === "income" || kind === "cumulative_income") {
        return hidePlan ? palette[0] : palette[dataset.plIsPlan ? 0 : 1];
    }
    if (kind === "expense" || kind === "cumulative_expense") {
        return hidePlan ? palette[1] : palette[dataset.plIsPlan ? 2 : 3];
    }
    if (kind === "period_profit" || kind === "cumulative_profit") {
        // hidePlan palette: income, expense, actual-profit yellow. Keep yellow shades.
        return hidePlan ? palette[2] : palette[dataset.plIsPlan ? 4 : 5];
    }

    return palette[index] || palette[palette.length - 1];
}

function build_pl_profit_dash_series(dataset, color, frm) {
    const stackGroup = get_pl_chart_bar_stack_group(dataset);
    const data = dataset.values.map((value, index) => [index, value]);

    return {
        name: dataset.name,
        type: "custom",
        z: PL_CHART_LAYER_Z.profit,
        stackGroup,
        color,
        itemStyle: { color },
        renderItem(params, api) {
            const categoryIndex = params.dataIndex;
            const profitValue = api.value(1);
            if (profitValue == null || Number.isNaN(profitValue)) {
                return;
            }

            const point = api.coord([categoryIndex, profitValue]);
            const bandWidth = api.size([1, 0])[0];
            const geo = get_pl_profit_dash_geometry(frm, stackGroup, bandWidth);
            const xCenter = point[0] + geo.offsetX;
            const halfWidth = geo.dashWidth / 2;
            const y = point[1];
            const labelLayout = get_pl_profit_label_layout(profitValue, y);

            return {
                type: "group",
                children: [
                    {
                        type: "line",
                        shape: {
                            x1: xCenter - halfWidth,
                            y1: y,
                            x2: xCenter + halfWidth,
                            y2: y,
                        },
                        style: {
                            stroke: color,
                            lineWidth: 2,
                            lineDash: [4, 4],
                        },
                    },
                    {
                        type: "text",
                        x: xCenter,
                        y: labelLayout.y,
                        style: {
                            text: format_pl_chart_axis_value(profitValue),
                            fill: color,
                            fontSize: 11,
                            textAlign: "center",
                            textVerticalAlign: labelLayout.verticalAlign,
                        },
                    },
                ],
            };
        },
        encode: {
            x: 0,
            y: 1,
        },
        data,
        tooltip: {
            show: true,
        },
    };
}

function build_pl_chart_series_item(dataset, color, layer, frm) {
    let series;

    if (layer === "bar") {
        series = {
            ...build_pl_bar_series(dataset.name, dataset.values, color, {
                stack: get_pl_chart_bar_stack_group(dataset),
            }),
            z: PL_CHART_LAYER_Z.bar,
        };
    } else if (layer === "cumulative") {
        const isProfitSeries = is_pl_cumulative_profit_series(dataset);
        const useArea =
            isProfitSeries ||
            (frm.budget_accumulated_values && is_pl_cumulative_volume_series(dataset));
        series = {
            ...build_pl_line_series(dataset.name, dataset.values, color, {
                showLine: true,
                showSymbol: false,
                area: useArea,
                lineWidth: isProfitSeries ? 2 : 1,
            }),
            z: PL_CHART_LAYER_Z.cumulative,
        };
    } else {
        series = build_pl_profit_dash_series(dataset, color, frm);
    }

    return {
        ...series,
        color,
    };
}

function build_pl_line_series(name, values, color, options = {}) {
    const {
        showLine = true,
        showSymbol = false,
        area = false,
        markLine = null,
        lineWidth = 2,
    } = options;

    const series = {
        name,
        type: "line",
        data: values,
        smooth: true,
        showSymbol,
        symbolSize: showSymbol ? 6 : 0,
        lineStyle: {
            color,
            width: showLine ? lineWidth : 0,
            opacity: showLine ? 1 : 0,
        },
        itemStyle: { color },
        emphasis: { focus: "series" },
    };

    if (area) {
        series.areaStyle = {
            color,
            opacity: 0.18,
        };
    }

    if (markLine) {
        series.markLine = markLine;
    }

    return series;
}

function get_pl_chart_y_axis_range(chartData) {
    let min = Infinity;
    let max = -Infinity;

    chartData.datasets.forEach((dataset) => {
        dataset.values.forEach((value) => {
            min = Math.min(min, value);
            max = Math.max(max, value);
        });
    });

    chartData.yMarkers?.forEach((marker) => {
        min = Math.min(min, marker.value);
        max = Math.max(max, marker.value);
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return {};
    }

    if (min === max) {
        const pad = Math.abs(min) * 0.1 || 1;
        return {
            min: min - pad,
            max: max + pad,
        };
    }

    const pad = (max - min) * 0.05;
    return {
        min: min - pad,
        max: max + pad,
    };
}

function get_pl_chart_current_period_index(periods) {
    if (!periods?.length || !frappe.datetime?.get_today || !frappe.datetime?.str_to_obj) {
        return -1;
    }

    const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const quarter = Math.floor((month - 1) / 3) + 1;

    return periods.findIndex((period) => {
        if (period.year == null) {
            return false;
        }
        if (period.year !== year) {
            return false;
        }
        if (period.month != null) {
            return Number(period.month) === month;
        }
        if (period.quarter != null) {
            return Number(period.quarter) === quarter;
        }
        return true;
    });
}

function build_pl_chart_plan_profit_mark_line_entry(marker, chartData, themeColors) {
    const labels = chartData.labels || [];
    const firstCategory = labels[0] ?? 0;
    const lastCategory = labels[labels.length - 1] ?? firstCategory;
    const markerLabel = {
        show: true,
        formatter: marker.label,
        color: themeColors.text,
        fontSize: 12,
        position: "insideStartTop",
        align: "left",
        verticalAlign: "bottom",
        distance: 8,
    };

    return [
        {
            coord: [firstCategory, marker.value],
            symbol: "none",
            label: markerLabel,
        },
        {
            coord: [lastCategory, marker.value],
            symbol: "none",
        },
    ];
}

function build_pl_chart_current_date_mark_line_entry(
    categoryIndex,
    themeColors,
    categoryLabel,
    options = {}
) {
    const showLabel = options.showLabel !== false;

    return {
        xAxis: categoryIndex,
        lineStyle: {
            color: themeColors.text,
            width: PL_CHART_CURRENT_DATE_LINE_WIDTH,
            type: "solid",
        },
        label: {
            show: showLabel,
            formatter: categoryLabel,
            color: themeColors.text,
            fontSize: 11,
            position: "end",
        },
    };
}

function build_pl_chart_mark_line_config(data, themeColors) {
    return {
        silent: true,
        symbol: ["none", "none"],
        precision: 2,
        lineStyle: {
            color: themeColors.muted,
            type: "dashed",
            width: 1,
        },
        label: {
            show: false,
        },
        data,
    };
}

function build_pl_chart_mark_line(marker, chartData, themeColors) {
    return build_pl_chart_mark_line_config(
        [build_pl_chart_plan_profit_mark_line_entry(marker, chartData, themeColors)],
        themeColors
    );
}

function apply_pl_chart_mark_lines(targetSeries, markLineData, themeColors) {
    if (!targetSeries || !markLineData.length) {
        return;
    }

    targetSeries.markLine = build_pl_chart_mark_line_config(markLineData, themeColors);
}

function get_pl_echarts_option(frm, chartData) {
    const themeColors = get_pl_chart_theme_colors();
    const palette = frm.bg_hide_plan ? PL_CHART_COLORS_HIDE_PLAN : PL_CHART_COLORS_SHOW_PLAN;
    const layeredDatasets = chartData.datasets.map((dataset, index) => ({
        dataset,
        color: get_pl_chart_dataset_color(dataset, index, palette, frm),
        layer: get_pl_chart_dataset_layer(dataset),
    }));
    const series = [];

    PL_CHART_LAYER_ORDER.forEach((layer) => {
        let layerItems = layeredDatasets.filter((item) => item.layer === layer);
        if (layer === "bar") {
            layerItems = sort_pl_chart_bar_layer_items(layerItems);
        }

        layerItems.forEach((item) => {
            series.push(build_pl_chart_series_item(item.dataset, item.color, item.layer, frm));
        });
    });

    const barSeries = series.find((item) => item.type === "bar");
    const cumulativeSeries =
        series.find((item) => item.areaStyle) || series[series.length - 1];

    const planProfitMarkLine = [];
    if (frm.bg_hide_plan && chartData.yMarkers?.length) {
        planProfitMarkLine.push(
            build_pl_chart_plan_profit_mark_line_entry(
                chartData.yMarkers[0],
                chartData,
                themeColors
            )
        );
    }
    apply_pl_chart_mark_lines(barSeries, planProfitMarkLine, themeColors);

    const currentDateMarkLine = [];
    const currentPeriodIndex = get_pl_chart_current_period_index(chartData.dataObj?.periods);
    if (currentPeriodIndex >= 0) {
        currentDateMarkLine.push(
            build_pl_chart_current_date_mark_line_entry(
                currentPeriodIndex,
                themeColors,
                chartData.labels[currentPeriodIndex],
                { showLabel: !frm.hide_current_date_mark_line_label }
            )
        );
    }
    apply_pl_chart_mark_lines(cumulativeSeries, currentDateMarkLine, themeColors);

    return {
        animation: true,
        backgroundColor: "transparent",
        color: series.map((item) => item.color),
        grid: {
            left: 72,
            right: 24,
            top: 24,
            bottom: 48,
            containLabel: false,
        },
        tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            backgroundColor: themeColors.bg,
            borderColor: themeColors.border,
            textStyle: { color: themeColors.text },
            valueFormatter: (value) => format_pl_chart_tooltip_value(value, frm),
        },
        legend: {
            show: false,
        },
        toolbox: build_pl_chart_toolbox(themeColors, frm),
        xAxis: {
            type: "category",
            data: chartData.labels,
            axisLabel: {
                color: themeColors.axisLabel,
            },
            axisLine: {
                lineStyle: { color: themeColors.border },
            },
            splitLine: {
                show: true,
                lineStyle: {
                    color: themeColors.gridLine,
                    width: 1,
                },
            },
        },
        yAxis: {
            type: "value",
            ...get_pl_chart_y_axis_range(chartData),
            axisLabel: {
                color: themeColors.axisLabel,
                formatter: format_pl_chart_axis_value,
            },
            splitLine: {
                lineStyle: {
                    color: themeColors.gridLine,
                    width: 1,
                },
            },
        },
        series,
    };
}

function dispose_pl_chart_instance(frm) {
    if (!frm?._pl_chart_instance) {
        return;
    }

    if (_plChartActiveFrm === frm) {
        _plChartActiveFrm = null;
    }

    if (typeof frm._pl_chart_instance.dispose === "function") {
        frm._pl_chart_instance.dispose();
    }

    frm._pl_chart_instance = null;
}

function get_pl_chart_wrapper(frm) {
    const field = frm?.get_field?.("custom_pl_chart");
    if (!field) {
        return null;
    }

    const fieldWrapper = $(field.wrapper || field.$wrapper);
    if (fieldWrapper.length) {
        const $inner = fieldWrapper.find("div[data-fieldname='custom_pl_chart']").first();
        frm.$pl_chart = $inner.length ? $inner : fieldWrapper;
    } else {
        frm.$pl_chart = $(frm.wrapper).find("div[data-fieldname='custom_pl_chart']").first();
    }

    if (!frm.$pl_chart || !frm.$pl_chart.length) {
        return null;
    }

    frm.$pl_chart.show?.();
    return frm.$pl_chart;
}

function get_pl_chart_dom(frm) {
    const $wrapper = get_pl_chart_wrapper(frm);
    if (!$wrapper) {
        return null;
    }

    $wrapper.addClass("pl-chart-wrapper");
    $wrapper.toggleClass("pl-chart-with-plan", !frm.bg_hide_plan);
    $wrapper.toggleClass("pl-chart-expanded", is_pl_chart_expanded(frm));

    let $chartContainer = $wrapper.find(".pl-chart-container");
    if (!$chartContainer.length) {
        $wrapper.empty();
        $chartContainer = $('<div class="pl-chart-container"></div>').appendTo($wrapper);
    }

    return $chartContainer.get(0);
}

function resize_pl_chart(frm) {
    if (!frm?._pl_chart_instance) {
        return;
    }

    frm._pl_chart_instance.resize();
}

function schedule_pl_chart_resize(frm) {
    if (!frm?._pl_chart_instance) {
        return;
    }

    const runResize = () => resize_pl_chart(frm);
    runResize();
    window.requestAnimationFrame(function () {
        runResize();
        window.requestAnimationFrame(runResize);
    });
    window.setTimeout(runResize, 50);
    window.setTimeout(runResize, 200);
}

function ensure_pl_chart_resize_observer(frm, chartDom) {
    if (typeof ResizeObserver === "undefined" || !chartDom || !frm) {
        return;
    }

    if (_plChartResizeObserver && _plChartResizeObserverTarget === frm) {
        return;
    }

    if (_plChartResizeObserver) {
        _plChartResizeObserver.disconnect();
        _plChartResizeObserver = null;
        _plChartResizeObserverTarget = null;
    }

    _plChartResizeObserver = new ResizeObserver(function () {
        resize_pl_chart(frm);
    });
    _plChartResizeObserver.observe(chartDom);
    _plChartResizeObserverTarget = frm;
}

function bind_pl_tab_listener_once(frm) {
    if (frm._pl_tab_listener_bound) {
        return;
    }

    const $wrapper = frm.$wrapper || (frm.wrapper && $(frm.wrapper));
    if (!$wrapper || !$wrapper.length) {
        return;
    }

    $wrapper.on("shown.bs.tab", '[data-fieldname="custom_pl"]', function () {
        schedule_pl_chart_resize(frm);
    });
    frm._pl_tab_listener_bound = true;
}

function refresh_budget_report_chart_theme() {
    const br =
        typeof dinext_projects_pl !== "undefined" &&
        dinext_projects_pl.budget_plan_vs_forecast;
    const report = typeof frappe !== "undefined" && frappe.query_report;

    if (!br || !br._budget_chart_instance || !report || !report.data || !report.data.length) {
        return;
    }
    if (typeof br.is_budget_report_view === "function" && !br.is_budget_report_view(report)) {
        return;
    }
    if (typeof br.get_budget_chart_presentation !== "function") {
        return;
    }

    const chartData = br.get_budget_chart_presentation(report);
    const frm = br.build_budget_chart_frm(report);
    const option = get_pl_echarts_option(frm, chartData);
    br._budget_chart_instance.setOption(option, true);
    if (typeof br.resize_budget_chart === "function") {
        br.resize_budget_chart();
    }
}

function refresh_pl_charts_theme() {
    if (_plChartActiveFrm?._pl_chart_instance) {
        const frm = _plChartActiveFrm;
        const chartData = get_pl_chart_data(frm);
        const option = get_pl_echarts_option(frm, chartData);
        frm._pl_chart_instance.setOption(option, true);
        frm._pl_chart_instance.resize();
    }

    refresh_budget_report_chart_theme();
}

function ensure_pl_chart_theme_observer() {
    if (typeof MutationObserver === "undefined" || _plChartThemeObserver) {
        return;
    }

    const root = document.documentElement;
    if (!root) {
        return;
    }

    let theme = root.getAttribute("data-theme");
    let themeMode = root.getAttribute("data-theme-mode");

    _plChartThemeObserver = new MutationObserver(function () {
        const nextTheme = root.getAttribute("data-theme");
        const nextThemeMode = root.getAttribute("data-theme-mode");
        if (nextTheme === theme && nextThemeMode === themeMode) {
            return;
        }
        theme = nextTheme;
        themeMode = nextThemeMode;
        refresh_pl_charts_theme();
    });

    _plChartThemeObserver.observe(root, {
        attributes: true,
        attributeFilter: ["data-theme", "data-theme-mode"],
    });
}

function next_pl_chart_render_seq(frm) {
    frm._plChartRenderSeq = (frm._plChartRenderSeq || 0) + 1;
    return frm._plChartRenderSeq;
}

function is_stale_pl_chart_render(frm, seq) {
    return seq != null && frm._plChartRenderSeq !== seq;
}

function render_pl_chart_impl(frm, init = true) {
    bind_pl_tab_listener_once(frm);

    const seq = next_pl_chart_render_seq(frm);
    const plRowCount = (() => {
        const walk = (rows) =>
            (rows || []).reduce((n, r) => n + 1 + walk(r.children), 0);
        return walk(frm.project_budget?.rows);
    })();
    if (plRowCount > LARGE_DATA_THRESHOLD) {
        if (pl_chart_debug_enabled()) {
            console.log("requestIdleCallback( render_pl_chart )");
        }
        window.requestIdleCallback(function () {
            if (is_stale_pl_chart_render(frm, seq)) {
                return;
            }
            _render_pl_chart(frm, init, seq);
        });
        return;
    }

    return _render_pl_chart(frm, init, seq);
}

function _render_pl_chart(frm, init = true, seq = null) {
    if (pl_chart_debug_enabled()) {
        console.time("render_pl_chart");
    }

    const token = seq ?? next_pl_chart_render_seq(frm);
    return load_pl_echarts()
        .then(function () {
            if (is_stale_pl_chart_render(frm, token)) {
                if (pl_chart_debug_enabled()) {
                    console.timeEnd("render_pl_chart");
                }
                return;
            }
            try {
                // Financial metrics: owned by project_budget_metrics.js (lazy tab Метрики).
                // Do not call render_financial_metrics here — avoids duplicate API on P&L open.

                const chartData = get_pl_chart_data(frm);
                const option = get_pl_echarts_option(frm, chartData);

                if (frm._pl_chart_instance && !init) {
                    frm._pl_chart_instance.setOption(option, true);
                    schedule_pl_chart_resize(frm);
                    if (pl_chart_debug_enabled()) {
                        console.timeEnd("render_pl_chart");
                    }
                    return;
                }

                dispose_pl_chart_instance(frm);

                const $wrapper = get_pl_chart_wrapper(frm);
                if (init && $wrapper) {
                    $wrapper.empty();
                }

                const chartDom = get_pl_chart_dom(frm);
                if (!chartDom) {
                    if (pl_chart_debug_enabled()) {
                        console.timeEnd("render_pl_chart");
                    }
                    return;
                }

                frm._pl_chart_instance = window.echarts.init(chartDom);
                frm._pl_chart_instance.setOption(option, true);
                _plChartActiveFrm = frm;
                ensure_pl_chart_resize_observer(frm, chartDom);
                schedule_pl_chart_resize(frm);
                ensure_pl_chart_theme_observer();
            } catch (err) {
                console.error("render_pl_chart error:", err);
                const chartDom = get_pl_chart_dom(frm);
                if (chartDom) {
                    $(chartDom).html(
                        `<div class="pl-chart-error">${__(
                            "Error building P&L chart"
                        )}</div>`
                    );
                }
            }

            if (pl_chart_debug_enabled()) {
                console.timeEnd("render_pl_chart");
            }
        })
        .catch(function (err) {
            console.error("P&L Chart creation failed:", err);
            const chartDom = get_pl_chart_dom(frm);
            if (chartDom) {
                $(chartDom).html(
                    `<div class="pl-chart-error">${__("Error building P&L chart")}</div>`
                );
            }
            if (pl_chart_debug_enabled()) {
                console.timeEnd("render_pl_chart");
            }
        });
}

globalThis.render_pl_chart_impl = render_pl_chart_impl;
globalThis.build_pl_chart_data = build_pl_chart_data;
globalThis.get_pl_chart_data = get_pl_chart_data;
globalThis.get_pl_echarts_option = get_pl_echarts_option;
globalThis.get_pl_profit_dash_geometry = get_pl_profit_dash_geometry;
globalThis.get_pl_profit_label_layout = get_pl_profit_label_layout;
globalThis.get_pl_chart_current_period_index = get_pl_chart_current_period_index;
globalThis.get_pl_chart_theme_colors = get_pl_chart_theme_colors;
globalThis.is_pl_chart_dark_theme = is_pl_chart_dark_theme;
globalThis.ensure_pl_chart_theme_observer = ensure_pl_chart_theme_observer;
globalThis.build_pl_profit_dash_series = build_pl_profit_dash_series;
globalThis._render_pl_chart = _render_pl_chart;
