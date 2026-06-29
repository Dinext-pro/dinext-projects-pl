const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const chartModulePath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"budget_report",
	"chart.js"
);

function loadBudgetChartModule() {
	const code = fs.readFileSync(chartModulePath, "utf8");
	const context = {
		frappe: {
			provide() {},
		},
		cint(value, default_value) {
			const parsed = parseInt(value, 10);
			return Number.isNaN(parsed) ? default_value || 0 : parsed;
		},
		flt(value) {
			return parseFloat(value) || 0;
		},
		__() {
			return arguments[0];
		},
		dinext_projects_pl: {
			budget_plan_vs_forecast: {},
		},
		console,
	};
	vm.createContext(context);
	vm.runInContext(code, context);
	return context.dinext_projects_pl.budget_plan_vs_forecast;
}

function makeReport({ accumulated_values = 0 } = {}) {
	return {
		data: [
			{
				indent: 0,
				root_type: "Income",
				plan_2026_01: 100,
				plan_2026_02: 150,
			},
			{
				indent: 0,
				root_type: "Expense",
				plan_2026_01: 40,
				plan_2026_02: 50,
			},
		],
		columns: [
			{
				fieldname: "plan_2026_01",
				period_group: "2026_01",
				period_group_label: "Jan 2026",
				period_role: "plan",
			},
			{
				fieldname: "plan_2026_02",
				period_group: "2026_02",
				period_group_label: "Feb 2026",
				period_role: "plan",
			},
		],
		get_filter_value(fieldname) {
			if (fieldname === "accumulated_values") {
				return accumulated_values;
			}
			return null;
		},
	};
}

test("build_budget_chart_data does not double-accumulate cumulative profit", () => {
	const br = loadBudgetChartModule();
	const report = makeReport({ accumulated_values: 1 });

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 60);
	assert.equal(chartData.profit_plan[1], 100);
	assert.equal(chartData.cumulative_profit_plan[0], 60);
	assert.equal(chartData.cumulative_profit_plan[1], 100);
	assert.notEqual(chartData.cumulative_profit_plan, chartData.profit_plan);
});

test("build_budget_chart_data builds cumulative profit from period values", () => {
	const br = loadBudgetChartModule();
	const report = {
		...makeReport({ accumulated_values: 0 }),
		data: [
			{
				indent: 0,
				root_type: "Income",
				plan_2026_01: 100,
				plan_2026_02: 50,
			},
			{
				indent: 0,
				root_type: "Expense",
				plan_2026_01: 40,
				plan_2026_02: 10,
			},
		],
	};

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 60);
	assert.equal(chartData.profit_plan[1], 40);
	assert.equal(chartData.cumulative_profit_plan[0], 60);
	assert.equal(chartData.cumulative_profit_plan[1], 100);
});

test("build_budget_chart_data handles quarter fieldnames when accumulated", () => {
	const br = loadBudgetChartModule();
	const report = {
		data: [
			{
				indent: 0,
				root_type: "Income",
				plan_2026_Q1: 60,
				plan_2026_Q2: 210,
			},
			{
				indent: 0,
				root_type: "Expense",
				plan_2026_Q1: 6,
				plan_2026_Q2: 21,
			},
		],
		columns: [
			{
				fieldname: "plan_2026_Q1",
				period_group: "2026_Q1",
				period_group_label: "Q1 2026",
				period_role: "plan",
			},
			{
				fieldname: "plan_2026_Q2",
				period_group: "2026_Q2",
				period_group_label: "Q2 2026",
				period_role: "plan",
			},
		],
		get_filter_value(fieldname) {
			if (fieldname === "accumulated_values") {
				return 1;
			}
			return null;
		},
	};

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 54);
	assert.equal(chartData.profit_plan[1], 189);
	assert.equal(chartData.cumulative_profit_plan[0], 54);
	assert.equal(chartData.cumulative_profit_plan[1], 189);
});

test("build_budget_chart_data accumulates actual display columns independently", () => {
	const br = loadBudgetChartModule();
	const report = {
		data: [
			{
				indent: 0,
				root_type: "Income",
				actual_2026_01: 100,
				actual_2026_02: 150,
			},
			{
				indent: 0,
				root_type: "Expense",
				actual_2026_01: 10,
				actual_2026_02: 15,
			},
		],
		columns: [
			{
				fieldname: "actual_2026_01",
				period_group: "2026_01",
				period_group_label: "Jan 2026",
				period_role: "display",
			},
			{
				fieldname: "actual_2026_02",
				period_group: "2026_02",
				period_group_label: "Feb 2026",
				period_role: "display",
			},
		],
		get_filter_value(fieldname) {
			if (fieldname === "accumulated_values") {
				return 1;
			}
			if (fieldname === "view_type") {
				return "forecast_actual";
			}
			return null;
		},
	};

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_actual[0], 90);
	assert.equal(chartData.profit_actual[1], 135);
	assert.equal(chartData.cumulative_profit_actual[0], 90);
	assert.equal(chartData.cumulative_profit_actual[1], 135);
});
