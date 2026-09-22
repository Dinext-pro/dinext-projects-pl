import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChartData } from "../../dinext_projects_pl/public/js/project_budget/chart-adapter.js";
import {
	applyAccumulatedValues,
	applyFactRollup,
	buildSummaryFromRoots,
	calcProfitabilityPct,
} from "../../dinext_projects_pl/public/js/project_budget/data.js";

globalThis.__ = (text) => text;

const KEY = "2026_8";
const KEY2 = "2026_9";
const VIEW = "forecast_only";

function period(key, isPast = false) {
	return { key, year: 2026, month: Number(key.split("_")[1]), is_past: isPast };
}

function amt(overrides, key) {
	const plan = overrides.plan ?? overrides.own_plan ?? 0;
	const forecast = overrides.forecast ?? overrides.own_forecast ?? 0;
	const fact = overrides.fact ?? overrides.own_fact ?? 0;
	return {
		[`own_plan_${key}`]: overrides.own_plan ?? 0,
		[`plan_${key}`]: plan,
		[`own_forecast_${key}`]: overrides.own_forecast !== undefined ? overrides.own_forecast : null,
		[`forecast_${key}`]: forecast,
		[`own_fact_${key}`]: overrides.own_fact ?? 0,
		[`fact_${key}`]: fact,
		[`actual_${key}`]: forecast,
	};
}

function row(id, overrides = {}, key = KEY) {
	return {
		id,
		account: overrides.account ?? id,
		account_label: overrides.account_label ?? id,
		root_type: overrides.root_type,
		dimensions: overrides.dimensions ?? [],
		children: overrides.children ?? [],
		risk: overrides.risk ?? null,
		...amt(overrides, key),
	};
}

function summarize(rows, periods, accumulated = false, viewMode = VIEW) {
	for (const node of rows) {
		applyFactRollup(node, periods, viewMode);
		if (accumulated) applyAccumulatedValues(node, periods);
	}
	return buildSummaryFromRoots(rows, periods, accumulated, viewMode);
}

function profitRow(summary) {
	return summary.find((item) => item.summary_kind === "profit");
}

function profitabilityRow(summary) {
	return summary.find((item) => item.summary_kind === "profitability");
}

function chartFrom(rows, periods, accumulated = false, viewMode = VIEW) {
	return buildChartData({
		bg_accumulated_values: accumulated,
		project_budget: { periods, rows, view_mode: viewMode },
	});
}

test("agg expense root + risk child: profit uses expense+risk once", () => {
	const periods = [period(KEY)];
	const income = row("inc", { root_type: "Income", own_plan: 1000, own_forecast: 1000 });
	const leaf = row("leaf", { own_plan: 200, own_forecast: 200 });
	const risk = row("risk-1", { risk: "RISK-1", own_plan: 50, own_forecast: 50 });
	const expense = row("exp", {
		root_type: "Expense",
		own_plan: 0,
		own_forecast: null,
		children: [leaf, risk],
	});

	const [profit] = summarize([income, expense], periods);
	assert.equal(profit[`plan_${KEY}`], 750);
	assert.equal(profit[`actual_${KEY}`], 750);
	assert.equal(expense[`plan_${KEY}`], 250);
});

test("own expense root + risk child: profit still subtracts risk", () => {
	const periods = [period(KEY)];
	const income = row("inc", { root_type: "Income", own_plan: 1000, own_forecast: 1000 });
	const risk = row("risk-1", { risk: "RISK-1", own_plan: 50, own_forecast: 50 });
	const expense = row("exp", {
		root_type: "Expense",
		own_plan: 200,
		own_forecast: 200,
		children: [risk],
	});

	const [profit] = summarize([income, expense], periods);
	assert.equal(expense[`plan_${KEY}`], 200);
	assert.equal(profit[`plan_${KEY}`], 750);
	assert.equal(profit[`actual_${KEY}`], 750);
});

test("accumulated last-period profit includes risk on own expense root", () => {
	const periods = [period(KEY), period(KEY2)];
	const income = {
		...row("inc", { root_type: "Income", own_plan: 100, own_forecast: 100 }, KEY),
		...amt({ own_plan: 100, own_forecast: 100 }, KEY2),
	};
	const risk = {
		...row("risk-1", { risk: "RISK-1", own_plan: 10, own_forecast: 10 }, KEY),
		...amt({ own_plan: 10, own_forecast: 10 }, KEY2),
	};
	const expense = {
		...row("exp", { root_type: "Expense", own_plan: 40, own_forecast: 40, children: [risk] }, KEY),
		...amt({ own_plan: 40, own_forecast: 40 }, KEY2),
	};

	const summary = summarize([income, expense], periods, true);
	const profit = profitRow(summary);
	assert.equal(expense[`plan_${KEY2}`], 80);
	assert.equal(profit[`plan_${KEY2}`], 100);
	assert.equal(profit[`actual_${KEY2}`], 100);
	assert.equal(profit.plan_total, 100);
	assert.equal(profit.actual_total, 100);
});

test("no-income → profitability null", () => {
	assert.equal(calcProfitabilityPct(100, 0), null);
	assert.equal(calcProfitabilityPct(100, null), null);

	const periods = [period(KEY)];
	const risk = row("risk-1", { risk: "RISK-1", own_plan: 50, own_forecast: 50 });
	const expense = row("exp", {
		root_type: "Expense",
		own_plan: 200,
		own_forecast: 200,
		children: [risk],
	});
	const summary = summarize([expense], periods);
	const profitability = profitabilityRow(summary);
	assert.equal(profitability[`plan_${KEY}`], null);
	assert.equal(profitability[`actual_${KEY}`], null);
	assert.equal(profitability.plan_total, null);
});

test("own expense + risk: chart period expense/profit match summary extras", () => {
	const periods = [period(KEY)];
	const income = row("inc", { root_type: "Income", own_plan: 1000, own_forecast: 1000 });
	const risk = row("risk-1", { risk: "RISK-1", own_plan: 50, own_forecast: 50 });
	const expense = row("exp", {
		root_type: "Expense",
		own_plan: 200,
		own_forecast: 200,
		children: [risk],
	});

	const summary = summarize([income, expense], periods);
	const profit = profitRow(summary);
	const profitability = profitabilityRow(summary);
	const chart = chartFrom([income, expense], periods);

	assert.equal(expense[`plan_${KEY}`], 200);
	assert.equal(chart.plan_expenses[0], -250);
	assert.equal(chart.actual_expenses[0], -250);
	assert.equal(chart.profit_plan[0], profit[`plan_${KEY}`]);
	assert.equal(chart.profit_actual[0], profit[`actual_${KEY}`]);
	assert.equal(chart.profit_plan[0], 750);
	assert.equal(
		calcProfitabilityPct(chart.profit_plan[0], chart.plan_income[0]),
		profitability[`plan_${KEY}`]
	);
});

test("agg expense + risk: chart does not double-count risk", () => {
	const periods = [period(KEY)];
	const income = row("inc", { root_type: "Income", own_plan: 1000, own_forecast: 1000 });
	const leaf = row("leaf", { own_plan: 200, own_forecast: 200 });
	const risk = row("risk-1", { risk: "RISK-1", own_plan: 50, own_forecast: 50 });
	const expense = row("exp", {
		root_type: "Expense",
		own_plan: 0,
		own_forecast: null,
		children: [leaf, risk],
	});

	const summary = summarize([income, expense], periods);
	const profit = profitRow(summary);
	const chart = chartFrom([income, expense], periods);

	assert.equal(expense[`plan_${KEY}`], 250);
	assert.equal(chart.plan_expenses[0], -250);
	assert.equal(chart.profit_plan[0], profit[`plan_${KEY}`]);
	assert.equal(chart.profit_plan[0], 750);
});

test("accumulated own expense + risk: chart last period matches summary extras", () => {
	const periods = [period(KEY), period(KEY2)];
	const income = {
		...row("inc", { root_type: "Income", own_plan: 100, own_forecast: 100 }, KEY),
		...amt({ own_plan: 100, own_forecast: 100 }, KEY2),
	};
	const risk = {
		...row("risk-1", { risk: "RISK-1", own_plan: 10, own_forecast: 10 }, KEY),
		...amt({ own_plan: 10, own_forecast: 10 }, KEY2),
	};
	const expense = {
		...row("exp", { root_type: "Expense", own_plan: 40, own_forecast: 40, children: [risk] }, KEY),
		...amt({ own_plan: 40, own_forecast: 40 }, KEY2),
	};

	const summary = summarize([income, expense], periods, true);
	const profit = profitRow(summary);
	const chart = chartFrom([income, expense], periods, true);

	assert.equal(expense[`plan_${KEY2}`], 80);
	assert.equal(chart.plan_expenses[1], -100);
	assert.equal(chart.profit_plan[1], profit[`plan_${KEY2}`]);
	assert.equal(chart.profit_plan[1], 100);
});
