import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyUpdatesToTree,
	buildParentAdjustmentsFromUpdates,
} from "../../dinext_projects_pl/public/js/project_budget/budget-tree.js";
import { applyFactRollup } from "../../dinext_projects_pl/public/js/project_budget/data.js";

const KEY = "2026_8";
const PERIODS = [{ key: KEY, year: 2026, month: 8, is_past: false }];

globalThis.flt = (value, precision) => {
	const n = Number(value) || 0;
	if (precision == null) return n;
	const factor = 10 ** precision;
	return Math.round(n * factor) / factor;
};

function row(id, overrides = {}) {
	return {
		id,
		account: overrides.account ?? id,
		account_label: overrides.account_label ?? id,
		dimensions: overrides.dimensions ?? [],
		children: overrides.children ?? [],
		task: overrides.task ?? null,
		risk: overrides.risk ?? null,
		[`own_forecast_${KEY}`]: overrides.own_forecast ?? 0,
		[`forecast_${KEY}`]: overrides.forecast ?? overrides.own_forecast ?? 0,
		[`own_plan_${KEY}`]: overrides.own_plan ?? 0,
		[`plan_${KEY}`]: overrides.plan ?? overrides.own_plan ?? 0,
		[`own_fact_${KEY}`]: overrides.own_fact ?? 0,
		[`fact_${KEY}`]: overrides.fact ?? 0,
	};
}

function riskUpdate({ account, riskId, amount, taskId }) {
	const dimensions = [];
	if (taskId) dimensions.push({ doc: "Task", docname: taskId });
	dimensions.push({ doc: "Project Risk", docname: riskId });
	return {
		account,
		dimensions,
		period_amount_map: { [KEY]: amount },
	};
}

function displayedForecast(node) {
	applyFactRollup(node, PERIODS, "forecast_only");
	return Number(node[`forecast_${KEY}`] || 0);
}

test("own parent too small → parent_adjustments writes raised own", () => {
	const child = row("child-task", {
		account: "Acc-1",
		task: "TASK-1",
		dimensions: [{ doc: "Task", docname: "TASK-1" }],
		own_forecast: 40,
		forecast: 40,
	});
	const account = row("Acc-1", {
		own_forecast: 60,
		forecast: 60,
		children: [child],
	});
	const { parent_adjustments, adjusted_parents } = buildParentAdjustmentsFromUpdates(
		{ project_budget: { rows: [account] } },
		[riskUpdate({ account: "Acc-1", riskId: "RISK-1", amount: 50 })]
	);

	assert.equal(parent_adjustments.length, 1);
	assert.equal(parent_adjustments[0].account, "Acc-1");
	assert.equal(parent_adjustments[0].period_amount_map[KEY], 90);
	assert.equal(adjusted_parents.length, 1);
});

test("aggregated parent (own 0) → no own write, display grows via rollup", () => {
	const child = row("child-task", {
		account: "Acc-1",
		task: "TASK-1",
		dimensions: [{ doc: "Task", docname: "TASK-1" }],
		own_forecast: 40,
		forecast: 40,
	});
	const account = row("Acc-1", {
		own_forecast: 0,
		forecast: 40,
		children: [child],
	});
	const updates = [riskUpdate({ account: "Acc-1", riskId: "RISK-1", amount: 50 })];
	const { parent_adjustments } = buildParentAdjustmentsFromUpdates(
		{ project_budget: { rows: [account] } },
		updates
	);
	assert.deepEqual(parent_adjustments, []);

	const simulated = applyUpdatesToTree([account], updates);
	assert.equal(displayedForecast(simulated[0]), 90);
	assert.equal(simulated[0][`own_forecast_${KEY}`], 0);
	assert.ok(simulated[0].children.some((c) => c.risk === "RISK-1"));
});

test("risk on Task: own task + own account both raised", () => {
	const task = row("Acc-1TASK-1", {
		account: "Acc-1",
		task: "TASK-1",
		dimensions: [{ doc: "Task", docname: "TASK-1" }],
		own_forecast: 20,
		forecast: 20,
	});
	const account = row("Acc-1", {
		own_forecast: 30,
		forecast: 30,
		children: [task],
	});
	const { parent_adjustments } = buildParentAdjustmentsFromUpdates(
		{ project_budget: { rows: [account] } },
		[riskUpdate({ account: "Acc-1", riskId: "RISK-1", amount: 50, taskId: "TASK-1" })]
	);

	const byAccount = Object.fromEntries(
		parent_adjustments.map((item) => [item.account + "|" + (item.dimensions[0]?.docname || ""), item])
	);
	assert.equal(parent_adjustments.length, 2);
	assert.equal(byAccount["Acc-1|TASK-1"].period_amount_map[KEY], 50);
	assert.equal(byAccount["Acc-1|"].period_amount_map[KEY], 50);
});

test("risk on Task: agg task grows via rollup, own account is raised", () => {
	const task = row("Acc-1TASK-1", {
		account: "Acc-1",
		task: "TASK-1",
		dimensions: [{ doc: "Task", docname: "TASK-1" }],
		own_forecast: 0,
		forecast: 0,
	});
	const account = row("Acc-1", {
		own_forecast: 30,
		forecast: 30,
		children: [task],
	});
	const updates = [
		riskUpdate({ account: "Acc-1", riskId: "RISK-1", amount: 50, taskId: "TASK-1" }),
	];
	const { parent_adjustments } = buildParentAdjustmentsFromUpdates(
		{ project_budget: { rows: [account] } },
		updates
	);
	assert.equal(parent_adjustments.length, 1);
	assert.equal(parent_adjustments[0].account, "Acc-1");
	assert.deepEqual(parent_adjustments[0].dimensions, []);
	assert.equal(parent_adjustments[0].period_amount_map[KEY], 50);

	const simulated = applyUpdatesToTree([account], updates);
	const taskRow = simulated[0].children.find((c) => c.task === "TASK-1");
	assert.equal(displayedForecast(taskRow), 50);
	assert.equal(taskRow[`own_forecast_${KEY}`], 0);
});

test("server-shaped Task risk (no row.task, Task in dims) still raises parents", () => {
	const risk = row("Acc-1TASK-1|risk|RISK-1", {
		account: "Acc-1",
		risk: "RISK-1",
		dimensions: [
			{ doc: "Task", docname: "TASK-1" },
			{ doc: "Project Risk", docname: "RISK-1" },
		],
		own_forecast: 10,
		forecast: 10,
	});
	delete risk.task;
	const task = row("Acc-1TASK-1", {
		account: "Acc-1",
		task: "TASK-1",
		dimensions: [{ doc: "Task", docname: "TASK-1" }],
		own_forecast: 20,
		forecast: 20,
		children: [risk],
	});
	const account = row("Acc-1", {
		own_forecast: 30,
		forecast: 30,
		children: [task],
	});
	const { parent_adjustments } = buildParentAdjustmentsFromUpdates(
		{ project_budget: { rows: [account] } },
		[riskUpdate({ account: "Acc-1", riskId: "RISK-1", amount: 50, taskId: "TASK-1" })]
	);
	assert.equal(parent_adjustments.length, 2);
	const byKey = Object.fromEntries(
		parent_adjustments.map((item) => [item.account + "|" + (item.dimensions[0]?.docname || ""), item])
	);
	assert.equal(byKey["Acc-1|TASK-1"].period_amount_map[KEY], 60);
	assert.equal(byKey["Acc-1|"].period_amount_map[KEY], 60);
});
