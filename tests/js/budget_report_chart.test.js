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
const presentationModulePath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"budget_report",
	"presentation.js"
);

function loadBudgetChartModules() {
	const context = {
		frappe: {
			provide() {},
		},
		cint(value, default_value) {
			const parsed = parseInt(value, 10);
			return Number.isNaN(parsed) ? default_value || 0 : parsed;
		},
		flt(value, precision) {
			const parsed = parseFloat(value) || 0;
			if (precision != null) {
				return parseFloat(parsed.toFixed(precision));
			}
			return parsed;
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
	vm.runInContext(fs.readFileSync(chartModulePath, "utf8"), context);
	vm.runInContext(fs.readFileSync(presentationModulePath, "utf8"), context);
	const br = context.dinext_projects_pl.budget_plan_vs_forecast;
	br.__ = function (text) {
		return text;
	};
	return br;
}

function deepClone(data) {
	return JSON.parse(JSON.stringify(data));
}

function preTransformAccumulatedData(br, report) {
	const filters = report.get_filter_values();
	const columns = report.columns || [];
	let data = deepClone(report.data);
	data = data.filter((row) => !row.is_profit_row && !row.is_profitability_row);
	br.applyAccumulatedValues(data, columns, filters);
	return data;
}

function makeReport({ accumulated_values = 0, data, columns } = {}) {
	const defaultData = [
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
	];
	const defaultColumns = [
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
	];

	const report = {
		data: deepClone(data || defaultData),
		columns: columns || defaultColumns,
		get_filter_value(fieldname) {
			if (fieldname === "accumulated_values") {
				return accumulated_values;
			}
			return null;
		},
		get_filter_values() {
			return {
				accumulated_values,
				show_plan: 1,
				view_type: "plan_only",
			};
		},
	};

	if (accumulated_values) {
		report._budget_source_snapshot = deepClone(data || defaultData);
		const br = loadBudgetChartModules();
		report.data = preTransformAccumulatedData(br, report);
	}

	return report;
}

test("build_budget_chart_data does not double-accumulate cumulative profit", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({ accumulated_values: 1 });

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 60);
	assert.equal(chartData.profit_plan[1], 100);
	assert.equal(chartData.cumulative_profit_plan[0], 60);
	assert.equal(chartData.cumulative_profit_plan[1], 100);
	assert.notEqual(chartData.cumulative_profit_plan, chartData.profit_plan);
});

test("build_budget_chart_data builds cumulative profit from period values", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({ accumulated_values: 0 });

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 60);
	assert.equal(chartData.profit_plan[1], 40);
	assert.equal(chartData.cumulative_profit_plan[0], 60);
	assert.equal(chartData.cumulative_profit_plan[1], 100);
});

test("build_budget_chart_data handles quarter fieldnames when accumulated", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({
		accumulated_values: 1,
		data: [
			{
				indent: 0,
				root_type: "Income",
				plan_2026_Q1: 60,
				plan_2026_Q2: 150,
			},
			{
				indent: 0,
				root_type: "Expense",
				plan_2026_Q1: 6,
				plan_2026_Q2: 15,
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
	});

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_plan[0], 54);
	assert.equal(chartData.profit_plan[1], 189);
	assert.equal(chartData.cumulative_profit_plan[0], 54);
	assert.equal(chartData.cumulative_profit_plan[1], 189);
});

test("build_budget_chart_data accumulates actual display columns independently", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({
		accumulated_values: 1,
		data: [
			{
				indent: 0,
				root_type: "Income",
				actual_2026_01: 100,
				actual_2026_02: 50,
			},
			{
				indent: 0,
				root_type: "Expense",
				actual_2026_01: 10,
				actual_2026_02: 5,
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
	});
	report.get_filter_values = function () {
		return {
			accumulated_values: 1,
			show_plan: 0,
			view_type: "forecast_actual",
		};
	};
	report.get_filter_value = function (fieldname) {
		if (fieldname === "accumulated_values") {
			return 1;
		}
		if (fieldname === "view_type") {
			return "forecast_actual";
		}
		return null;
	};

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.profit_actual[0], 90);
	assert.equal(chartData.profit_actual[1], 135);
	assert.equal(chartData.cumulative_profit_actual[0], 90);
	assert.equal(chartData.cumulative_profit_actual[1], 135);
});

test("get_budget_chart_presentation adds period bars alongside cumulative lines when accumulated", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({ accumulated_values: 1 });
	report.get_filter_values = function () {
		return {
			accumulated_values: 1,
			show_plan: 1,
			view_type: "plan_only",
		};
	};

	const presentation = br.get_budget_chart_presentation(report);
	const names = presentation.datasets.map((dataset) => dataset.name);
	const layers = presentation.datasets.map((dataset) => dataset.plLayer);
	const incomeBar = presentation.datasets.find(
		(dataset) => dataset.plLayer === "bar" && dataset.plSeriesKind === "income" && dataset.plIsPlan
	);
	const cumulativeIncome = presentation.datasets.find(
		(dataset) => dataset.plSeriesKind === "cumulative_income" && dataset.plIsPlan
	);

	assert.ok(names.some((name) => name.includes("Cumulative income")));
	assert.ok(names.some((name) => name.includes("Cumulative expenses")));
	assert.ok(names.some((name) => name.includes("Cumulative profit")));
	assert.ok(names.some((name) => name.includes("Income - plan")));
	assert.ok(names.some((name) => name.includes("Expenses - plan")));
	assert.ok(layers.includes("bar"));
	assert.ok(layers.includes("cumulative"));
	assert.equal(incomeBar.values[0], 100);
	assert.equal(incomeBar.values[1], 50);
	assert.equal(cumulativeIncome.values[0], 100);
	assert.equal(cumulativeIncome.values[1], 150);
});

test("build_budget_chart_data exposes period values from source snapshot when accumulated", () => {
	const br = loadBudgetChartModules();
	const report = makeReport({ accumulated_values: 1 });

	const chartData = br.build_budget_chart_data(report);

	assert.equal(chartData.period_plan_income[0], 100);
	assert.equal(chartData.period_plan_income[1], 50);
	assert.equal(chartData.plan_income[0], 100);
	assert.equal(chartData.plan_income[1], 150);
});
