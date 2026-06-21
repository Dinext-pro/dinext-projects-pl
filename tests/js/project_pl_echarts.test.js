const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const echartsModulePath = path.resolve(
    __dirname,
    "..",
    "..",
    "dinext_projects_pl",
    "public",
    "js",
    "project_pl_echarts.js"
);

class FakeElement {
    constructor(label = "element") {
        this.label = label;
        this.length = 1;
        this[0] = this;
        this.children = [];
        this.classes = new Set();
    }

    find() {
        return this.length ? this : new FakeElement("empty");
    }

    first() {
        return this;
    }

    empty() {
        this.children = [];
        return this;
    }

    addClass(name) {
        this.classes.add(name);
        return this;
    }

    toggleClass(name, state) {
        if (state) {
            this.classes.add(name);
        } else {
            this.classes.delete(name);
        }
        return this;
    }

    append(child) {
        this.children.push(child);
        return this;
    }

    appendTo(parent) {
        parent.append(this);
        return this;
    }

    html(value) {
        this.htmlValue = value;
        return this;
    }

    get() {
        return [this];
    }
}

function createTranslationStub() {
    return (text) => text;
}

function createEchartsContext() {
    const echartsCalls = {
        init: [],
        setOption: [],
        resize: [],
        dispose: [],
    };

    const dollar = (value) => {
        if (value instanceof FakeElement) {
            return value;
        }

        if (typeof value === "string" && value.startsWith("<")) {
            return new FakeElement("generated");
        }

        return new FakeElement(typeof value === "string" ? value : "wrapped");
    };

    const context = {
        __: createTranslationStub(),
        console,
        $: dollar,
        __echartsCalls: echartsCalls,
        get_budget_display_periods() {
            return [
                { year: 2026, month: 1, is_past: true },
                { year: 2026, month: 2, is_past: false },
            ];
        },
        getFinancialRootRows(aggregatedBudget) {
            if (!aggregatedBudget) {
                return [];
            }
            return Object.values(aggregatedBudget).filter(
                (b) => !b.parent_account && !b.task && !b._parentKey && !b.risk
            );
        },
        calc_column_total() {
            return {
                plan_income: 100,
                actual_income: 90,
                plan_expenses: 40,
                actual_expenses: 35,
            };
        },
        frappe: {
            format(value) {
                return String(value);
            },
            require(_assets, callback) {
                callback();
            },
            utils: {
                format_chart_axis_number(value) {
                    return String(value);
                },
            },
            datetime: {
                get_today() {
                    return context.__plChartToday || "2025-06-15";
                },
                str_to_obj(value) {
                    const parts = String(value).split("-").map(Number);
                    return new Date(parts[0], parts[1] - 1, parts[2] || 1);
                },
            },
        },
        window: {
            requestIdleCallback(callback) {
                callback();
            },
            requestAnimationFrame(callback) {
                callback();
            },
            setTimeout(callback) {
                callback();
            },
            matchMedia() {
                return { matches: false };
            },
        },
        document: {
            documentElement: {
                getAttribute(name) {
                    return name === "data-theme" ? "light" : null;
                },
            },
        },
        MutationObserver: class {
            observe() {}

            disconnect() {}
        },
        getComputedStyle() {
            return {
                getPropertyValue() {
                    return "";
                },
            };
        },
    };

    context.window.echarts = {
        init(dom, theme) {
            echartsCalls.init.push({ dom, theme });
            const instance = {
                setOption(option, notMerge) {
                    echartsCalls.setOption.push({ option, notMerge });
                },
                resize() {
                    echartsCalls.resize.push(true);
                },
                dispose() {
                    echartsCalls.dispose.push(true);
                },
            };
            return instance;
        },
    };

    context.globalThis = context;
    return context;
}

function loadEchartsModule() {
    const source = fs.readFileSync(echartsModulePath, "utf8");
    const context = createEchartsContext();
    vm.createContext(context);
    vm.runInContext(source, context, { filename: echartsModulePath });
    return context;
}

function createChartFrm(overrides = {}) {
    const chartWrapper = new FakeElement("chart-wrapper");
    return {
        aggregatedBudget: { root: { parent_account: null, task: null } },
        bg_hide_plan: true,
        budget_view_options: "actual/forecast",
        get_field(fieldname) {
            if (fieldname === "custom_pl_chart") {
                return { $wrapper: chartWrapper };
            }

            return null;
        },
        ...overrides,
    };
}

test("echarts module exports chart entry points", () => {
    const context = loadEchartsModule();

    assert.equal(typeof context.render_pl_chart_impl, "function");
    assert.equal(typeof context.build_pl_chart_data, "function");
    assert.equal(typeof context.get_pl_chart_data, "function");
    assert.equal(typeof context.get_pl_echarts_option, "function");
    assert.equal(typeof context._render_pl_chart, "function");
});

test("get_pl_chart_data keeps expense values negative and adds plan marker when plan hidden", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true });
    const chartData = context.get_pl_chart_data(frm);

    assert.equal(chartData.datasets.length, 4);
    assert.equal(chartData.datasets[1].values[0], -35);
    assert.equal(chartData.yMarkers?.length, 1);
    assert.equal(chartData.yMarkers[0].value, 120);
    assert.equal(chartData.yMarkers[0].label, "Planned profit: 120");
});

test("build_pl_chart_data negates net expense totals for chart display", () => {
    const context = loadEchartsModule();
    context.calc_column_total = () => ({
        plan_income: 1000,
        actual_income: 700,
        plan_expenses: 1000,
        actual_expenses: 700,
    });
    const frm = createChartFrm({ bg_hide_plan: true });

    const data = context.build_pl_chart_data(frm);

    assert.equal(data.actual_income[0], 700);
    assert.equal(data.actual_expenses[0], -700);
    assert.equal(data.profit_actual[0], 0);
});

test("build_pl_chart_data keeps income corrections below prior gross income", () => {
    const context = loadEchartsModule();
    context.calc_column_total = () => ({
        plan_income: 1000,
        actual_income: 700,
        plan_expenses: 0,
        actual_expenses: 0,
    });
    const frm = createChartFrm({ bg_hide_plan: true });

    const data = context.build_pl_chart_data(frm);

    assert.equal(data.actual_income[0], 700);
    assert.equal(data.profit_actual[0], 700);
});

test("get_pl_chart_data includes plan series when plan is visible", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: false });
    const chartData = context.get_pl_chart_data(frm);

    assert.equal(chartData.datasets.length, 8);
    assert.equal(chartData.yMarkers, null);
});

test("get_pl_echarts_option adds cumulative area lines and plan marker line", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true });
    const chartData = context.get_pl_chart_data(frm);
    const option = context.get_pl_echarts_option(frm, chartData);
    const cumulativeSeries = option.series.filter((series) => series.areaStyle);
    const markerSeries = option.series.find((series) => series.markLine);

    assert.equal(cumulativeSeries.length, 1);
    assert.ok(markerSeries);
    assert.equal(markerSeries.type, "bar");
    assert.equal(markerSeries.markLine.data[0][0].coord[1], 120);
    assert.equal(markerSeries.markLine.data[0][0].label.position, "insideStartTop");
    assert.equal(markerSeries.markLine.data[0][0].label.formatter, "Planned profit: 120");
});

test("get_pl_echarts_option expands y axis to include plan profit marker", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true });
    const chartData = context.get_pl_chart_data(frm);

    chartData.datasets.forEach((dataset) => {
        dataset.values = dataset.values.map(() => 100);
    });
    chartData.datasets[1].values[0] = -35;
    chartData.yMarkers = [
        {
            label: "Planned profit: 2400000",
            value: 2400000,
        },
    ];

    const option = context.get_pl_echarts_option(frm, chartData);

    assert.ok(option.yAxis.max >= 2400000);
    assert.ok(option.yAxis.min <= -35);
});

test("get_pl_echarts_option orders series cumulative then bars then profit", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));

    const cumulativeIndex = option.series.findIndex((series) => series.areaStyle);
    const barIndex = option.series.findIndex((series) => series.type === "bar");
    const profitIndex = option.series.findIndex((series) => series.type === "custom");

    assert.ok(cumulativeIndex >= 0);
    assert.ok(barIndex >= 0);
    assert.ok(profitIndex >= 0);
    assert.ok(cumulativeIndex < barIndex);
    assert.ok(barIndex < profitIndex);

    const cumulativeSeries = option.series.filter((series) => series.areaStyle);
    const profitSeries = option.series.filter((series) => series.type === "custom");

    cumulativeSeries.forEach((series) => {
        assert.ok(series.lineStyle.width > 0);
        assert.equal(series.z, 1);
    });

    option.series
        .filter((series) => series.type === "bar")
        .forEach((series) => {
            assert.equal(series.z, 2);
        });

    profitSeries.forEach((series) => {
        assert.equal(typeof series.renderItem, "function");
        assert.equal(series.z, 3);
    });
});

test("get_pl_echarts_option renders profit as dashed custom series aligned to stacks", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const profitSeries = option.series.filter((series) => series.type === "custom");

    assert.equal(profitSeries.length, 2);

    const planProfit = profitSeries.find((series) => series.stackGroup === "plan");
    const actualProfit = profitSeries.find((series) => series.stackGroup === "actual");

    assert.ok(planProfit);
    assert.ok(actualProfit);
    assert.equal(typeof planProfit.renderItem, "function");
    assert.equal(typeof actualProfit.renderItem, "function");
    assert.ok(String(planProfit.name).includes("Profit"));
    assert.ok(String(actualProfit.name).includes("Profit"));
});

test("get_pl_echarts_option aligns series colors with tooltip palette", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));

    assert.equal(option.series.length, 8);
    assert.equal(option.color.length, option.series.length);

    option.series.forEach((series, index) => {
        assert.equal(option.color[index], series.color);
    });

    const planProfit = option.series.find(
        (series) => series.type === "custom" && series.stackGroup === "plan"
    );
    const actualProfit = option.series.find(
        (series) => series.type === "custom" && series.stackGroup === "actual"
    );

    assert.equal(planProfit.color, "#ffcc66");
    assert.equal(actualProfit.color, "#ff9933");
    assert.equal(planProfit.itemStyle.color, "#ffcc66");
    assert.equal(actualProfit.itemStyle.color, "#ff9933");
});

test("get_pl_profit_dash_geometry centers dash on plan and actual stack slots", () => {
    const context = loadEchartsModule();
    const bandWidth = 100;

    const withPlan = context.get_pl_profit_dash_geometry(
        createChartFrm({ bg_hide_plan: false }),
        "plan",
        bandWidth
    );
    const actualWithPlan = context.get_pl_profit_dash_geometry(
        createChartFrm({ bg_hide_plan: false }),
        "actual",
        bandWidth
    );
    const actualOnly = context.get_pl_profit_dash_geometry(
        createChartFrm({ bg_hide_plan: true }),
        "actual",
        bandWidth
    );

    assert.equal(withPlan.stackCount, 2);
    assert.equal(withPlan.slotIndex, 0);
    assert.equal(actualWithPlan.slotIndex, 1);
    assert.ok(withPlan.offsetX < 0);
    assert.ok(actualWithPlan.offsetX > 0);
    assert.equal(actualOnly.stackCount, 1);
    assert.equal(actualOnly.offsetX, 0);
    assert.equal(withPlan.dashWidth, bandWidth / 2 * 0.8);
});

test("get_pl_chart_current_period_index matches calendar today to project periods", () => {
    const context = loadEchartsModule();
    const periods = [
        { year: 2026, month: 1, is_past: true },
        { year: 2026, month: 2, is_past: false },
    ];

    context.__plChartToday = "2026-02-15";
    assert.equal(context.get_pl_chart_current_period_index(periods), 1);

    context.__plChartToday = "2027-01-01";
    assert.equal(context.get_pl_chart_current_period_index(periods), -1);
});

test("get_pl_echarts_option enables vertical month grid on x axis", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));

    assert.equal(option.xAxis.splitLine.show, true);
    assert.equal(option.xAxis.splitLine.lineStyle.width, 1);
});

test("get_pl_echarts_option adds saveAsImage toolbox", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true, doc: { name: "PRJ-001" } });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const saveAsImage = option.toolbox.feature.saveAsImage;

    assert.equal(saveAsImage.show, true);
    assert.equal(saveAsImage.title, "Save as Image");
    assert.equal(saveAsImage.pixelRatio, 2);
    assert.equal(saveAsImage.type, "png");
    assert.equal(saveAsImage.name, "project-pl-PRJ-001");
    assert.ok(saveAsImage.backgroundColor);
    assert.notEqual(saveAsImage.backgroundColor, "transparent");
    assert.equal(option.toolbox.right, 8);
    assert.equal(option.toolbox.itemSize, 16);
});

test("get_pl_echarts_option adds current date vertical markLine when month is in range", () => {
    const context = loadEchartsModule();
    context.__plChartToday = "2026-02-15";
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const cumulativeMarkerSeries = option.series.find(
        (series) => series.areaStyle && series.markLine
    );

    assert.ok(cumulativeMarkerSeries);
    assert.equal(cumulativeMarkerSeries.markLine.data.length, 1);
    assert.equal(cumulativeMarkerSeries.markLine.data[0].xAxis, 1);
    assert.equal(cumulativeMarkerSeries.markLine.data[0].label.formatter, "2026-02");
    assert.equal(option.series.some((series) => series.type === "bar" && series.markLine), false);
});

test("get_pl_echarts_option merges plan profit and current date markLines", () => {
    const context = loadEchartsModule();
    context.__plChartToday = "2026-02-15";
    const frm = createChartFrm({ bg_hide_plan: true });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const barMarkerSeries = option.series.find(
        (series) => series.type === "bar" && series.markLine
    );
    const cumulativeMarkerSeries = option.series.find(
        (series) => series.areaStyle && series.markLine
    );

    assert.ok(barMarkerSeries);
    assert.ok(cumulativeMarkerSeries);
    assert.equal(barMarkerSeries.markLine.data.length, 1);
    assert.equal(barMarkerSeries.markLine.data[0][0].coord[1], 120);
    assert.equal(cumulativeMarkerSeries.markLine.data.length, 1);
    assert.equal(cumulativeMarkerSeries.markLine.data[0].xAxis, 1);
});

test("get_pl_echarts_option skips current date markLine outside project range", () => {
    const context = loadEchartsModule();
    context.__plChartToday = "2025-06-15";
    const frm = createChartFrm({ bg_hide_plan: true });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const barMarkerSeries = option.series.find(
        (series) => series.type === "bar" && series.markLine
    );
    const cumulativeMarkerSeries = option.series.find(
        (series) => series.areaStyle && series.markLine
    );

    assert.ok(barMarkerSeries);
    assert.equal(barMarkerSeries.markLine.data.length, 1);
    assert.equal(barMarkerSeries.markLine.data[0][0].coord[1], 120);
    assert.equal(barMarkerSeries.markLine.data[0].xAxis, undefined);
    assert.equal(cumulativeMarkerSeries, undefined);
});

test("get_pl_echarts_option keeps current date markLine off bar series when plan visible", () => {
    const context = loadEchartsModule();
    context.__plChartToday = "2026-02-15";
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));

    option.series
        .filter((series) => series.type === "bar")
        .forEach((series) => {
            assert.equal(series.markLine, undefined);
        });

    const cumulativeMarkerSeries = option.series.find(
        (series) => series.areaStyle && series.markLine
    );
    assert.ok(cumulativeMarkerSeries);
    assert.equal(cumulativeMarkerSeries.markLine.data[0].xAxis, 1);
});

test("get_pl_profit_label_layout places label above for non-negative and below for negative", () => {
    const context = loadEchartsModule();
    const lineY = 100;
    const gap = 6;

    const positive = context.get_pl_profit_label_layout(700, lineY, gap);
    const zero = context.get_pl_profit_label_layout(0, lineY, gap);
    const negative = context.get_pl_profit_label_layout(-35, lineY, gap);

    assert.equal(positive.verticalAlign, "bottom");
    assert.equal(positive.y, lineY - gap);
    assert.ok(positive.y < lineY);

    assert.equal(zero.verticalAlign, "bottom");
    assert.equal(zero.y, lineY - gap);

    assert.equal(negative.verticalAlign, "top");
    assert.equal(negative.y, lineY + gap);
    assert.ok(negative.y > lineY);
});

test("get_pl_echarts_option stacks plan and actual bars separately", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: false });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const barSeries = option.series.filter((series) => series.type === "bar");

    assert.equal(barSeries.length, 4);
    barSeries.forEach((series) => {
        assert.equal(series.z, 2);
        assert.equal(series.stackStrategy, "samesign");
        assert.equal(series.barMaxWidth, 40);
    });

    const planBars = barSeries.filter((series) => series.stack === "plan");
    const actualBars = barSeries.filter((series) => series.stack === "actual");

    assert.equal(planBars.length, 2);
    assert.equal(actualBars.length, 2);
    assert.ok(String(planBars[0].name).includes("Income"));
    assert.ok(String(planBars[1].name).includes("Expenses"));
    assert.ok(String(actualBars[0].name).includes("Income"));
    assert.ok(String(actualBars[1].name).includes("Expenses"));
});

test("get_pl_echarts_option uses only actual stack when plan is hidden", () => {
    const context = loadEchartsModule();
    const frm = createChartFrm({ bg_hide_plan: true });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const barSeries = option.series.filter((series) => series.type === "bar");

    assert.equal(barSeries.length, 2);
    barSeries.forEach((series) => {
        assert.equal(series.stack, "actual");
        assert.equal(series.stackStrategy, "samesign");
    });
});

test("tooltip valueFormatter returns plain currency text without html wrapper", () => {
    const context = loadEchartsModule();
    const captured = [];
    context.frappe.format = (value, df, options, doc) => {
        captured.push({ df, options, doc });
        if (options?.only_value) {
            return `RUB ${value}`;
        }

        return `<div style='text-align: right'>RUB ${value}</div>`;
    };

    const frm = createChartFrm({
        bg_hide_plan: true,
        doc: { company: "Test Company", name: "PRJ-001" },
    });
    const option = context.get_pl_echarts_option(frm, context.get_pl_chart_data(frm));
    const formatted = option.tooltip.valueFormatter(1234.5);

    assert.equal(formatted, "RUB 1234.5");
    assert.equal(captured[0]?.options?.only_value, true);
    assert.equal(captured[0]?.df?.options, "Company:company:default_currency");
    assert.equal(captured[0]?.doc?.company, "Test Company");
    assert.equal(formatted.includes("<div"), false);
});

test("render_pl_chart invokes financial metrics and creates echarts instance", async () => {
    const context = loadEchartsModule();
    const frm = createChartFrm();
    frm.metricsRenderCount = 0;
    context.globalThis.render_financial_metrics = () => {
        frm.metricsRenderCount += 1;
    };

    await context._render_pl_chart(frm, true);

    assert.equal(frm.metricsRenderCount, 1);
    assert.equal(context.__echartsCalls.init.length, 1);
    assert.equal(context.__echartsCalls.setOption.length, 1);
    assert.ok(context.__echartsCalls.resize.length >= 1);
    assert.ok(frm._pl_chart_instance);
});

test("render_pl_chart update path reuses echarts instance", async () => {
    const context = loadEchartsModule();
    const frm = createChartFrm();
    context.globalThis.render_financial_metrics = () => {};

    await context._render_pl_chart(frm, true);
    const firstInstance = frm._pl_chart_instance;

    await context._render_pl_chart(frm, false);

    assert.equal(frm._pl_chart_instance, firstInstance);
    assert.equal(context.__echartsCalls.init.length, 1);
    assert.equal(context.__echartsCalls.setOption.length, 2);
});

test("build_pl_chart_data excludes root-level risk rows from financial totals", () => {
    const context = loadEchartsModule();
    let capturedRoots = null;
    context.calc_column_total = (_frm, _period, roots) => {
        capturedRoots = roots;
        return {
            plan_income: 0,
            actual_income: 1002000,
            plan_expenses: 0,
            actual_expenses: 134000,
        };
    };
    const frm = createChartFrm({
        aggregatedBudget: {
            income: {
                value: "Income Root",
                type: "Income",
                parent_account: null,
                dimension_data: [],
            },
            expense: {
                value: "Expense Root",
                type: "Expense",
                parent_account: null,
                dimension_data: [],
            },
            "Expense Root|risk|RISK-001": {
                value: "Expense Root",
                type: "Expense",
                parent_account: null,
                _parentKey: "Expense Root",
                risk: { value: "RISK-001" },
                dimension_data: [],
            },
        },
    });

    const data = context.build_pl_chart_data(frm);

    assert.equal(capturedRoots.length, 2);
    assert.equal(data.profit_actual[0], 868000);
});
