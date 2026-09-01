const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function loadBudgetPresentationModule() {
	const code = fs.readFileSync(presentationModulePath, "utf8");
	const context = {
		frappe: {
			provide() {},
			datetime: {
				get_today() {
					return "2026-06-15";
				},
			},
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
		__(text) {
			return text;
		},
		dinext_projects_pl: {
			budget_plan_vs_forecast: {},
		},
		console,
	};
	vm.createContext(context);
	vm.runInContext(code, context);
	const br = context.dinext_projects_pl.budget_plan_vs_forecast;
	br.__ = function (text) {
		return text;
	};
	return br;
}

function monthColumns(year = 2026, months = [1, 2, 3]) {
	const columns = [];
	for (const month of months) {
		const monthKey = `${year}_${String(month).padStart(2, "0")}`;
		columns.push({
			fieldname: `plan_${monthKey}`,
			period_group: monthKey,
			period_role: "plan",
		});
	}
	columns.push({ fieldname: "total_plan", period_group: null });
	return columns;
}

function sampleRootRows(
	year = 2026,
	months = [1, 2, 3],
	values = {
		income_plan: [100, 50, 30],
		expense_plan: [40, 10, 5],
	}
) {
	const rows = [
		{
			account: "Income Root",
			indent: 0,
			root_type: "Income",
		},
		{
			account: "Expense Root",
			indent: 0,
			root_type: "Expense",
		},
	];
	months.forEach((month, index) => {
		const monthKey = `${year}_${String(month).padStart(2, "0")}`;
		rows[0][`plan_${monthKey}`] = values.income_plan[index];
		rows[1][`plan_${monthKey}`] = values.expense_plan[index];
	});
	return rows;
}

function profitRow(data) {
	const row = data.find((item) => item.is_profit_row);
	assert.ok(row, "Profit row not found");
	return row;
}

function deepClone(data) {
	return JSON.parse(JSON.stringify(data));
}

function runAccumulatedPipeline(br, data, columns, filters) {
	let rows = deepClone(data);
	const periodFilters = { ...filters, accumulated_values: 0 };
	br.addRowTotals(rows, periodFilters, columns);
	br.addProfitRow(rows, columns, periodFilters);

	rows = rows.filter((row) => !row.is_profit_row && !row.is_profitability_row);
	const accFilters = { ...filters, accumulated_values: 1 };
	br.applyAccumulatedValues(rows, columns, accFilters);
	br.addRowTotals(rows, accFilters, columns);
	return br.addProfitRow(rows, columns, accFilters);
}

test("applyAccumulatedValues keeps plan and display chains independent", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const columns = [
		{ fieldname: `plan_${year}_01`, period_group: `${year}_01`, period_role: "plan" },
		{ fieldname: `plan_${year}_02`, period_group: `${year}_02`, period_role: "plan" },
		{
			fieldname: `actual_${year}_01`,
			period_group: `${year}_01`,
			period_role: "display",
		},
		{
			fieldname: `actual_${year}_02`,
			period_group: `${year}_02`,
			period_role: "display",
		},
	];
	const data = [
		{
			account: "Test",
			[`plan_${year}_01`]: 10,
			[`plan_${year}_02`]: 5,
			[`actual_${year}_01`]: 100,
			[`actual_${year}_02`]: 20,
		},
	];

	const result = br.applyAccumulatedValues(deepClone(data), columns, {
		accumulated_values: 1,
		view_type: "actual_only",
	})[0];

	assert.equal(result[`plan_${year}_02`], 15);
	assert.equal(result[`actual_${year}_02`], 120);
});

test("applyAccumulatedValues unifies forecast_actual display timeline", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const columns = [
		{
			fieldname: `actual_${year}_01`,
			period_group: `${year}_01`,
			period_role: "display",
		},
		{
			fieldname: `actual_${year}_02`,
			period_group: `${year}_02`,
			period_role: "display",
		},
		{
			fieldname: `forecast_${year}_03`,
			period_group: `${year}_03`,
			period_role: "display",
		},
	];
	const data = [
		{
			account: "Test",
			[`actual_${year}_01`]: 100,
			[`actual_${year}_02`]: 50,
			[`forecast_${year}_03`]: 30,
		},
	];

	const result = br.applyAccumulatedValues(deepClone(data), columns, {
		accumulated_values: 1,
		view_type: "forecast_actual",
	})[0];

	assert.equal(result[`actual_${year}_02`], 150);
	assert.equal(result[`forecast_${year}_03`], 180);
});

test("addRowTotals accumulated uses last period not sum", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const columns = monthColumns(year);
	const data = [
		{
			account: "Income Root",
			[`plan_${year}_01`]: 100,
			[`plan_${year}_02`]: 150,
			[`plan_${year}_03`]: 180,
		},
	];

	const result = br.addRowTotals(deepClone(data), {
		accumulated_values: 1,
		show_plan: 1,
		view_type: "plan_only",
	}, columns)[0];

	assert.equal(result.total_plan, 180);
});

test("accumulated pipeline does not overstate profit total (285 vs 125 regression)", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const columns = monthColumns(year);
	const filters = {
		accumulated_values: 1,
		show_plan: 1,
		view_type: "plan_only",
	};

	const result = runAccumulatedPipeline(br, sampleRootRows(year), columns, filters);
	const profit = profitRow(result);

	const wrongTotal =
		(profit[`plan_${year}_01`] || 0) +
		(profit[`plan_${year}_02`] || 0) +
		(profit[`plan_${year}_03`] || 0);

	assert.notEqual(wrongTotal, profit.total_plan);
	assert.equal(profit.total_plan, 125);
	assert.equal(profit[`plan_${year}_03`], 125);
	assert.equal(profit[`plan_${year}_01`], 60);
	assert.equal(profit[`plan_${year}_02`], 100);
});

test("apply_budget_presentation toggle accumulated off restores period values", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const columns = monthColumns(year);
	const periodFilters = {
		accumulated_values: 0,
		show_plan: 1,
		view_type: "plan_only",
	};
	let periodData = deepClone(sampleRootRows(year));
	br.addRowTotals(periodData, periodFilters, columns);
	br.addProfitRow(periodData, columns, periodFilters);

	const report = {
		columns,
		data: deepClone(periodData),
		get_filter_values() {
			return {
				accumulated_values: report._accumulated,
				show_plan: 1,
				view_type: "plan_only",
			};
		},
		_accumulated: 1,
	};

	br.store_budget_source_snapshot(report);
	br.apply_budget_presentation(report);

	const accumulatedIncome = report.data.find((row) => row.account === "Income Root");
	const accumulatedProfit = profitRow(report.data);
	assert.equal(accumulatedIncome[`plan_${year}_03`], 180);
	assert.equal(accumulatedProfit.total_plan, 125);

	report._accumulated = 0;
	br.apply_budget_presentation(report);

	const periodIncome = report.data.find((row) => row.account === "Income Root");
	const periodProfit = profitRow(report.data);
	assert.equal(periodIncome[`plan_${year}_01`], 100);
	assert.equal(periodIncome[`plan_${year}_02`], 50);
	assert.equal(periodIncome[`plan_${year}_03`], 30);
	assert.equal(periodProfit[`plan_${year}_01`], 60);
	assert.equal(periodProfit[`plan_${year}_02`], 40);
	assert.equal(periodProfit[`plan_${year}_03`], 25);
	assert.equal(periodProfit.total_plan, 125);
});

test("addProfitRow subtracts risk reserves from profit without changing CoA rows", () => {
	const br = loadBudgetPresentationModule();
	const year = 2026;
	const monthKey = `${year}_06`;
	const columns = [
		{
			fieldname: `forecast_${monthKey}`,
			period_group: monthKey,
			period_role: "display",
		},
		{ fieldname: "total_exp", period_group: "total", period_role: "forecast" },
	];
	const rows = [
		{
			account: "Income Root",
			indent: 0,
			root_type: "Income",
			[`forecast_${monthKey}`]: 0,
		},
		{
			account: "Expense Root",
			indent: 0,
			root_type: "Expense",
			[`forecast_${monthKey}`]: 100_000,
		},
	];
	const riskTotals = {
		[monthKey]: { plan: 0, forecast: 500_000 },
	};

	br.addProfitRow(rows, columns, { view_type: "forecast_only" }, riskTotals);
	const profit = profitRow(rows);
	const expense = rows.find((row) => row.account === "Expense Root");

	assert.equal(expense[`forecast_${monthKey}`], 100_000);
	assert.equal(profit[`forecast_${monthKey}`], -600_000);
	assert.equal(profit.total_exp, -600_000);
});

test("expandPeriodKeyToMonthlyKeys covers month quarter year", () => {
	const br = loadBudgetPresentationModule();
	assert.equal(br.expandPeriodKeyToMonthlyKeys("2026_06").join(","), "2026_06");
	assert.equal(
		br.expandPeriodKeyToMonthlyKeys("2026_Q3").join(","),
		"2026_07,2026_08,2026_09"
	);
	assert.equal(br.expandPeriodKeyToMonthlyKeys("2026").length, 12);
	assert.equal(br.expandPeriodKeyToMonthlyKeys("2026")[0], "2026_01");
	assert.equal(br.expandPeriodKeyToMonthlyKeys("2026")[11], "2026_12");
});

test("addProfitRow quarter column sums monthly risk reserves", () => {
	const br = loadBudgetPresentationModule();
	const quarterKey = "2026_Q2";
	const columns = [
		{
			fieldname: `forecast_${quarterKey}`,
			period_group: quarterKey,
			period_role: "display",
		},
		{ fieldname: "total_exp", period_group: "total", period_role: "forecast" },
	];
	const rows = [
		{
			account: "Income Root",
			indent: 0,
			root_type: "Income",
			[`forecast_${quarterKey}`]: 0,
		},
		{
			account: "Expense Root",
			indent: 0,
			root_type: "Expense",
			[`forecast_${quarterKey}`]: 100_000,
		},
	];
	const riskTotals = {
		"2026_04": { plan: 0, forecast: 100_000 },
		"2026_05": { plan: 0, forecast: 200_000 },
		"2026_06": { plan: 0, forecast: 200_000 },
	};

	br.addProfitRow(rows, columns, { view_type: "forecast_only" }, riskTotals);
	const profit = profitRow(rows);
	const expense = rows.find((row) => row.account === "Expense Root");

	assert.equal(expense[`forecast_${quarterKey}`], 100_000);
	assert.equal(profit[`forecast_${quarterKey}`], -600_000);
	assert.equal(profit.total_exp, -600_000);
});
