import { test } from "node:test";
import assert from "node:assert/strict";
import {
	hasOwnPhysicalAmount,
	isOwnForecastCell,
	isOwnPlanCell,
	ownValueTooltip,
} from "../../dinext_projects_pl/public/js/project_budget/own-marker.js";

const KEY = "2026_7";
const FUTURE = { key: KEY, is_past: false };
const PAST = { key: KEY, is_past: true };

function row(amounts = {}) {
	return {
		id: amounts.id || "r",
		summary_kind: amounts.summary_kind,
		[`own_plan_${KEY}`]: amounts.own_plan,
		[`own_forecast_${KEY}`]: amounts.own_forecast,
		[`plan_${KEY}`]: amounts.plan,
		[`forecast_${KEY}`]: amounts.forecast,
	};
}

test("own plan: physical bucket marks cell", () => {
	assert.equal(isOwnPlanCell(row({ own_plan: 100, plan: 100 }), KEY), true);
	assert.equal(isOwnPlanCell(row({ own_plan: 0, plan: 70 }), KEY), false);
	assert.equal(isOwnPlanCell(row({ own_plan: null, plan: 70 }), KEY), false);
});

test("own forecast: only while cell shows forecast", () => {
	const own = row({ own_forecast: 50, forecast: 50 });
	assert.equal(isOwnForecastCell(own, FUTURE), true);
	assert.equal(isOwnForecastCell(own, PAST), false);
	assert.equal(isOwnForecastCell(row({ own_forecast: 0, forecast: 0 }), FUTURE), true);
	assert.equal(isOwnForecastCell(row({ own_forecast: null, forecast: 80 }), FUTURE), false);
});

test("leaf with physical amount still marks (Ivan)", () => {
	assert.equal(isOwnPlanCell(row({ id: "leaf", own_plan: 10 }), KEY), true);
	assert.equal(isOwnForecastCell(row({ id: "leaf", own_forecast: 10 }), FUTURE), true);
});

test("summary and empty row never mark", () => {
	assert.equal(isOwnPlanCell(row({ summary_kind: "profit", own_plan: 10 }), KEY), false);
	assert.equal(hasOwnPhysicalAmount(null, "plan", KEY), false);
	assert.equal(isOwnForecastCell(row({ own_forecast: 10 }), null), false);
});

test("tooltip only when own", () => {
	assert.equal(ownValueTooltip(true), "Manual value");
	assert.equal(ownValueTooltip(false), undefined);
});
