const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modulePath = path.resolve(
    __dirname,
    "..",
    "..",
    "dinext_projects_pl",
    "public",
    "js",
    "project_pl_financial_metrics.js"
);
const dashboardModulePath = path.resolve(
    __dirname,
    "..",
    "..",
    "dinext_projects_pl",
    "public",
    "js",
    "project_pl_dashboard.js"
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
        return this;
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

    removeClass() {
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

    show() {
        return this;
    }

    closest() {
        return this;
    }

    attr() {
        return this;
    }

    html(value) {
        this.htmlValue = value;
        return this;
    }
}

function createTranslationStub() {
    return (text, args) => {
        if (!Array.isArray(args) || !args.length) {
            return text;
        }

        return args.reduce(
            (result, value, index) => result.replace(`{${index}}`, String(value)),
            text
        );
    };
}

function createContext() {
    const controlCalls = [];
    const chartCalls = [];
    const formHandlers = {};
    const dollar = (value) => {
        if (value instanceof FakeElement) {
            return value;
        }

        return new FakeElement(typeof value === "string" ? value : "wrapped");
    };

    return {
        __: createTranslationStub(),
        console,
        $: dollar,
        __controlCalls: controlCalls,
        __chartCalls: chartCalls,
        __formHandlers: formHandlers,
        globalThis: {},
        get_budget_display_periods() {
            return [{ year: 2026, month: 1 }];
        },
        get_child_budget_sum() {
            return 0;
        },
        frappe: {
            datetime: {
                get_today() {
                    return "2026-01-15";
                },
                str_to_obj(value) {
                    return new Date(`${value}T00:00:00Z`);
                },
                str_to_user(value) {
                    return value;
                },
            },
            format(value) {
                return String(value);
            },
            utils: {
                escape_html(value) {
                    return String(value);
                },
            },
            ui: {
                form: {
                    make_control(options) {
                        controlCalls.push(options);
                        return options;
                    },
                    on(doctype, handlers) {
                        formHandlers[doctype] = handlers;
                        return null;
                    },
                },
            },
            Chart: class FakeChart {
                constructor(element, options) {
                    chartCalls.push({ element, options });
                    this.element = element;
                    this.options = options;
                }

                destroy() {
                    return null;
                }

                update() {
                    return null;
                }
            },
        },
    };
}

function loadFinancialMetricsModule() {
    const source = fs.readFileSync(modulePath, "utf8");
    const context = createContext();
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: modulePath });
    return context;
}

function loadDashboardModule() {
    const source = fs.readFileSync(dashboardModulePath, "utf8");
    const context = createContext();
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: dashboardModulePath });
    return context;
}

function loadDashboardModuleInWrappedScope() {
    const source = fs.readFileSync(dashboardModulePath, "utf8");
    const context = createContext();
    context.globalThis = context;
    context.window = context;
    context.get_pl_chart_data = () => ({
        labels: ["2026-01"],
        datasets: [],
    });
    context.get_pl_chart_options = (frm, data) => ({ data });
    context.globalThis.render_financial_metrics = (frm) => {
        frm.metricsRenderCount = (frm.metricsRenderCount || 0) + 1;
    };

    const wrappedSource = `
        (function () {
            const globalThis = context.globalThis;
            const window = context.window;
            const console = context.console;
            const __ = context.__;
            const frappe = context.frappe;
            const $ = context.$;
            ${source}
            get_pl_chart_data = context.get_pl_chart_data;
            get_pl_chart_options = context.get_pl_chart_options;
            context.__exports = { _render_pl_chart };
        })();
    `;

    const script = new vm.Script(wrappedSource, { filename: dashboardModulePath });
    script.runInNewContext({ context });
    return context;
}

test("financial metrics asset exports build and render entry points", () => {
    const context = loadFinancialMetricsModule();

    assert.equal(typeof context.build_financial_metrics, "function");
    assert.equal(typeof context.render_financial_metrics, "function");
});

test("build_financial_metrics returns grouped tracks for income and expense", () => {
    const context = loadFinancialMetricsModule();
    const frm = {
        doc: {
            percent_complete: 50,
        },
        aggregatedBudget: {
            income_root: {
                value: "Income Root",
                parent_account: "",
                task: "",
                type: "Income",
                dimension_data: [{ plan_2026_1: 1000, fact_2026_1: 250 }],
            },
            expense_root: {
                value: "Expense Root",
                parent_account: "",
                task: "",
                type: "Expense",
                dimension_data: [{ plan_2026_1: 400, fact_2026_1: 100 }],
            },
        },
        _financial_metrics_reporting_date: "2026-01-15",
    };

    const result = context.build_financial_metrics(frm);

    assert.equal(result.ready, true);
    assert.equal(result.tracks.length, 2);
    assert.deepEqual(
        Array.from(result.tracks, (track) => track.key),
        ["income", "expense"]
    );

    const expenseTrack = result.tracks.find((track) => track.key === "expense");
    assert.ok(expenseTrack);
    assert.equal(expenseTrack.values.BAC, 400);
    assert.equal(expenseTrack.values.EV, 200);
    assert.equal(expenseTrack.groups.length > 0, true);
});

test("render_financial_metrics re-renders when reporting date changes", () => {
    const context = loadFinancialMetricsModule();
    const metricsWrapper = new FakeElement("metrics-wrapper");
    const sectionWrapper = new FakeElement("section-wrapper");
    metricsWrapper.closest = () => sectionWrapper;
    const baseBuildFinancialMetrics = context.build_financial_metrics;
    const seenReportingDates = [];
    context.build_financial_metrics = (frm) => {
        seenReportingDates.push(frm._financial_metrics_reporting_date);
        return baseBuildFinancialMetrics(frm);
    };

    const frm = {
        doc: {
            percent_complete: 50,
            custom_metrics_reporting_date: "2026-01-15",
        },
        aggregatedBudget: {
            income_root: {
                value: "Income Root",
                parent_account: "",
                task: "",
                type: "Income",
                dimension_data: [{ plan_2026_1: 1000, fact_2026_1: 250 }],
            },
            expense_root: {
                value: "Expense Root",
                parent_account: "",
                task: "",
                type: "Expense",
                dimension_data: [{ plan_2026_1: 400, fact_2026_1: 100 }],
            },
        },
        wrapper: new FakeElement("form-wrapper"),
        get_field(fieldname) {
            if (fieldname === "custom_metrics") {
                return { wrapper: metricsWrapper, $wrapper: metricsWrapper };
            }

            if (fieldname === "custom_metrics_reporting_date") {
                return { wrapper: new FakeElement("date-field") };
            }

            return null;
        },
        set_df_property(fieldname, property, value) {
            this.hiddenField = { fieldname, property, value };
        },
    };

    context.render_financial_metrics(frm);
    assert.deepEqual(seenReportingDates, ["2026-01-15"]);
    assert.equal(context.__controlCalls.length, 1);
    assert.deepEqual(frm.hiddenField, {
        fieldname: "custom_metrics_reporting_date",
        property: "hidden",
        value: 1,
    });

    const dateControl = context.__controlCalls[0];
    dateControl.df.change.call({
        get_value() {
            return "2026-01-20";
        },
    });

    assert.equal(frm._financial_metrics_reporting_date, "2026-01-20");
    assert.equal(context.__controlCalls.length, 2);
});

test("dashboard chart render still invokes financial metrics and chart creation", () => {
    const context = loadDashboardModule();
    const chartWrapper = new FakeElement("chart-wrapper");

    context.render_financial_metrics = (frm) => {
        frm.metricsRenderCount = (frm.metricsRenderCount || 0) + 1;
    };
    context.get_pl_chart_data = () => ({
        labels: ["2026-01"],
        datasets: [],
    });
    context.get_pl_chart_options = (frm, data) => ({ data });

    const frm = {
        aggregatedBudget: { root: {} },
        bg_hide_plan: false,
        get_field(fieldname) {
            if (fieldname === "custom_pl_chart") {
                return { $wrapper: chartWrapper };
            }

            return null;
        },
    };

    context._render_pl_chart(frm, true);

    assert.equal(frm.metricsRenderCount, 1);
    assert.equal(context.__chartCalls.length, 1);
});

test("dashboard render uses global financial metrics contract", () => {
    const context = loadDashboardModuleInWrappedScope();
    const chartWrapper = new FakeElement("chart-wrapper");
    const frm = {
        aggregatedBudget: { root: {} },
        bg_hide_plan: false,
        get_field(fieldname) {
            if (fieldname === "custom_pl_chart") {
                return { $wrapper: chartWrapper };
            }

            return null;
        },
    };

    context.__exports._render_pl_chart(frm, true);

    assert.equal(frm.metricsRenderCount, 1);
    assert.equal(context.__chartCalls.length, 1);
});

test("dashboard refresh renders financial metrics immediately", () => {
    const context = loadDashboardModule();
    let renderCount = 0;
    context.globalThis.render_financial_metrics = () => {
        renderCount += 1;
    };
    context.add_buttons = () => {};
    context.add_project_profit_loss_chart = () => {};

    const frm = {
        doc: { name: "PROJ-0001" },
        is_new() {
            return false;
        },
    };

    context.__formHandlers.Project.refresh(frm);

    assert.equal(renderCount, 1);
});
