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

function createSampleMetricsPayload() {
    return {
        ready: true,
        note: "Метрики рассчитываются на отчетную дату 2026-01-15.",
        warning: null,
        reportingDate: "2026-01-15",
        progressPercent: 50,
        tracks: [
            {
                key: "income",
                label: "Доходы",
                values: { BAC: 1000, EV: 500 },
                groups: [
                    {
                        key: "base",
                        label: "Базовые",
                        metrics: [
                            {
                                key: "BAC",
                                label: "BAC",
                                kind: "currency",
                                shortName: "Бюджет по завершению",
                                formula:
                                    "Складываем все утвержденные плановые суммы по этому направлению за весь срок проекта.",
                                interpretation:
                                    "Это весь утвержденный бюджет проекта по выбранному направлению до самого завершения.",
                                value: 1000,
                                status: "neutral",
                            },
                        ],
                    },
                ],
            },
            {
                key: "expense",
                label: "Расходы",
                values: { BAC: 400, EV: 200 },
                groups: [
                    {
                        key: "base",
                        label: "Базовые",
                        metrics: [
                            {
                                key: "BAC",
                                label: "BAC",
                                kind: "currency",
                                shortName: "Бюджет по завершению",
                                formula:
                                    "Складываем все утвержденные плановые суммы по этому направлению за весь срок проекта.",
                                interpretation:
                                    "Это весь утвержденный бюджет проекта по выбранному направлению до самого завершения.",
                                value: 400,
                                status: "neutral",
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

function createContext() {
    const controlCalls = [];
    const chartCalls = [];
    const formHandlers = {};
    const apiCalls = [];
    const dollar = (value) => {
        if (value instanceof FakeElement) {
            return value;
        }

        return new FakeElement(typeof value === "string" ? value : "wrapped");
    };

    const context = {
        __: createTranslationStub(),
        console,
        $: dollar,
        __controlCalls: controlCalls,
        __chartCalls: chartCalls,
        __formHandlers: formHandlers,
        __apiCalls: apiCalls,
        globalThis: {},
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
            call(options) {
                apiCalls.push(options);
                const handler = context.__financialMetricsApiHandler;
                return Promise.resolve({
                    message: handler ? handler(options) : createSampleMetricsPayload(),
                });
            },
        },
    };

    context.globalThis = context;
    return context;
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

function collectRenderedMarkup(node) {
    if (typeof node === "string") {
        return node;
    }

    if (!node || typeof node !== "object") {
        return "";
    }

    const parts = [];
    if (typeof node.label === "string") {
        parts.push(node.label);
    }
    if (typeof node.htmlValue === "string") {
        parts.push(node.htmlValue);
    }
    if (Array.isArray(node.children)) {
        node.children.forEach((child) => {
            parts.push(collectRenderedMarkup(child));
        });
    }

    return parts.join(" ");
}

test("financial metrics asset exports build and render entry points", () => {
    const context = loadFinancialMetricsModule();

    assert.equal(typeof context.build_financial_metrics, "function");
    assert.equal(typeof context.render_financial_metrics, "function");
});

test("build_financial_metrics requests server payload", async () => {
    const context = loadFinancialMetricsModule();
    const frm = {
        doc: {
            name: "PROJ-0001",
            percent_complete: 50,
        },
        _financial_metrics_reporting_date: "2026-01-15",
        is_new() {
            return false;
        },
    };

    const result = await context.build_financial_metrics(frm);

    assert.equal(context.__apiCalls.length, 1);
    assert.equal(
        context.__apiCalls[0].method,
        "dinext_projects_pl.dinext_projects_pl.financial_metrics.service.get_project_financial_metrics"
    );
    assert.equal(context.__apiCalls[0].args.project, "PROJ-0001");
    assert.equal(context.__apiCalls[0].args.reporting_date, "2026-01-15");
    assert.equal(result.ready, true);
    assert.equal(result.tracks.length, 2);
});

test("render_financial_metrics re-renders when reporting date changes", async () => {
    const context = loadFinancialMetricsModule();
    const metricsWrapper = new FakeElement("metrics-wrapper");
    const sectionWrapper = new FakeElement("section-wrapper");
    metricsWrapper.closest = () => sectionWrapper;
    const seenReportingDates = [];
    context.__financialMetricsApiHandler = (options) => {
        seenReportingDates.push(options.args.reporting_date);
        return createSampleMetricsPayload();
    };

    const frm = {
        doc: {
            name: "PROJ-0001",
            percent_complete: 50,
            custom_metrics_reporting_date: "2026-01-15",
        },
        _financial_metrics_reporting_date: "2026-01-15",
        is_new() {
            return false;
        },
        aggregatedBudget: {},
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
    await new Promise((resolve) => setTimeout(resolve, 0));

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
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(frm._financial_metrics_reporting_date, "2026-01-20");
    assert.equal(context.__controlCalls.length, 2);
    assert.deepEqual(seenReportingDates, ["2026-01-15", "2026-01-20"]);
});

test("render_financial_metrics shows short names and detailed tooltip text", async () => {
    const context = loadFinancialMetricsModule();
    const metricsWrapper = new FakeElement("metrics-wrapper");
    const sectionWrapper = new FakeElement("section-wrapper");
    metricsWrapper.closest = () => sectionWrapper;
    context.__financialMetricsApiHandler = () => createSampleMetricsPayload();

    const frm = {
        doc: {
            name: "PROJ-0001",
            percent_complete: 50,
            custom_metrics_reporting_date: "2026-01-15",
        },
        _financial_metrics_reporting_date: "2026-01-15",
        is_new() {
            return false;
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
        set_df_property() {},
    };

    context.render_financial_metrics(frm);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const renderedMarkup = collectRenderedMarkup(metricsWrapper);
    assert.match(renderedMarkup, /BAC/);
    assert.match(renderedMarkup, /Бюджет по завершению/);
    assert.match(
        renderedMarkup,
        /Складываем все утвержденные плановые суммы по этому направлению за весь срок проекта\./
    );
    assert.match(renderedMarkup, /Это весь утвержденный бюджет проекта/);
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
