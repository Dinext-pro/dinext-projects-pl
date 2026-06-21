const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calcModulePath = path.resolve(
    __dirname,
    "..",
    "..",
    "dinext_projects_pl",
    "public",
    "js",
    "project_pl_calc.js"
);

function loadCalcModule() {
    const source = fs.readFileSync(calcModulePath, "utf8");
    const context = {
        console,
        globalThis: {},
        isChildOf(child, account, task, risk = null) {
            const matchesNestedTask =
                child.value == account && task && child.task?.parent_task == task;
            const matchesRootTask =
                child.value == account && !task && child.task && !child.task.parent_task;
            const matchesChildAccount =
                child.parent_account == account && !task && !child.task && !child.risk;
            const matchesRiskRow = child._parentKey === account + (task || "") && !risk;
            return matchesNestedTask || matchesRootTask || matchesChildAccount || matchesRiskRow;
        },
        get_budget_display_periods() {
            return [];
        },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: calcModulePath });
    return context;
}

function makeRootRow(value, type, dimension_data) {
    return {
        value,
        type,
        parent_account: null,
        dimension_data,
    };
}

function makeTask(value, subject, parent_task = null) {
    return { value, subject, parent_task, indent: 0 };
}

test("calc_column_total sums all top-level roots for each track", () => {
    const context = loadCalcModule();
    const period = { year: 2026, month: 1, is_past: false };
    const roots = [
        makeRootRow("Income A", "Income", [{ plan_2026_1: 30, forecast_2026_1: 25 }]),
        makeRootRow("Income B", "Income", [{ plan_2026_1: 40, forecast_2026_1: 35 }]),
        makeRootRow("Expense A", "Expense", [{ plan_2026_1: 10, forecast_2026_1: 8 }]),
        makeRootRow("Expense B", "Expense", [{ plan_2026_1: 20, forecast_2026_1: 16 }]),
    ];
    const frm = {
        aggregatedBudget: Object.fromEntries(roots.map((row, index) => [`root-${index}`, row])),
    };

    const result = context.calc_column_total(frm, period, roots, true);

    assert.equal(result.plan_income, 70);
    assert.equal(result.plan_expenses, 30);
    assert.equal(result.actual_income, 60);
    assert.equal(result.actual_expenses, 24);
});

test("calc_column_total sums all direct buckets before child fallback", () => {
    const context = loadCalcModule();
    const period = { year: 2026, month: 1, is_past: false };
    const roots = [
        makeRootRow("Expense Root", "Expense", [
            { plan_2026_1: 10, forecast_2026_1: 7 },
            { plan_2026_1: 20, forecast_2026_1: 5 },
        ]),
    ];
    const frm = {
        aggregatedBudget: { root: roots[0] },
    };

    const result = context.calc_column_total(frm, period, roots, true);

    assert.equal(result.plan_expenses, 30);
    assert.equal(result.actual_expenses, 12);
});

test("calc_column_total falls back to child totals when root has no direct value", () => {
    const context = loadCalcModule();
    const period = { year: 2026, month: 1, is_past: false };
    const root = makeRootRow("Expense Root", "Expense", [{ plan_2026_1: 0, forecast_2026_1: 0 }]);
    const child = {
        value: "Expense Child",
        type: "Expense",
        parent_account: "Expense Root",
        dimension_data: [{ plan_2026_1: 12, forecast_2026_1: 9 }],
    };
    const frm = {
        aggregatedBudget: {
            root,
            child,
        },
    };

    const result = context.calc_column_total(frm, period, [root], true);

    assert.equal(result.plan_expenses, 12);
    assert.equal(result.actual_expenses, 9);
});

test("updateTaskDimensionOptimized merges disallowed Task buckets into the account bucket", () => {
    const context = loadCalcModule();
    const accountRow = {
        value: "Подрядчики (МиП)",
        type: "Expense",
        parent_account: null,
        indent: 0,
        allowed_dimensions: [],
        dimension_data: [
            { dimensions: [{ doc: "Task", docname: "TASK-001" }], fact_2026_4: 10000, forecast_2026_4: 7000 },
            { dimensions: [{ doc: "Task", docname: "TASK-002" }], fact_2026_5: 48000, forecast_2026_5: 15000 },
        ],
    };
    const frm = {
        aggregatedBudget: { account: accountRow },
        aggregatedTasks: {
            "TASK-001": makeTask("TASK-001", "Task 1"),
            "TASK-002": makeTask("TASK-002", "Task 2"),
        },
    };

    context.updateTaskDimensionOptimized(frm);

    assert.deepEqual(Object.keys(frm.aggregatedBudget), ["Подрядчики (МиП)"]);
    assert.equal(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data.length, 1);
    assert.deepEqual(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data[0].dimensions || [], []);
    assert.equal(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data[0].fact_2026_4, 10000);
    assert.equal(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data[0].fact_2026_5, 48000);
    assert.equal(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data[0].forecast_2026_4, 7000);
    assert.equal(frm.aggregatedBudget["Подрядчики (МиП)"].dimension_data[0].forecast_2026_5, 15000);
});

test("calc_column_total uses merged facts after disallowed Task buckets collapse", () => {
    const context = loadCalcModule();
    const accountRow = {
        value: "Подрядчики (МиП)",
        type: "Expense",
        parent_account: null,
        indent: 0,
        allowed_dimensions: [],
        dimension_data: [
            { dimensions: [{ doc: "Task", docname: "TASK-001" }], fact_2026_4: 10000, forecast_2026_4: 7000 },
            { dimensions: [{ doc: "Task", docname: "TASK-002" }], fact_2026_4: 5000, forecast_2026_4: 3000 },
        ],
    };
    const frm = {
        aggregatedBudget: { account: accountRow },
        aggregatedTasks: {
            "TASK-001": makeTask("TASK-001", "Task 1"),
            "TASK-002": makeTask("TASK-002", "Task 2"),
        },
    };

    context.updateTaskDimensionOptimized(frm);

    const result = context.calc_column_total(
        frm,
        { year: 2026, month: 4, is_past: true },
        Object.values(frm.aggregatedBudget),
        false,
        true
    );

    assert.equal(result.plan_expenses, 0);
    assert.equal(result.actual_expenses, 15000);
});
