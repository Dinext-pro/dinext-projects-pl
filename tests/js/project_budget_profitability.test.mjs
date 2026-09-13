import { test } from "node:test";
import assert from "node:assert/strict";
import { calcProfitabilityPct } from "../../dinext_projects_pl/public/js/project_budget/data.js";

test("calcProfitabilityPct is (profit / income) * 100 to 1 decimal", () => {
	assert.equal(calcProfitabilityPct(255, 1000), 25.5);
	assert.equal(calcProfitabilityPct(0, 800), 0);
	assert.equal(calcProfitabilityPct(-30, 50), -60);
});

test("calcProfitabilityPct is null when no income", () => {
	assert.equal(calcProfitabilityPct(100, 0), null);
	assert.equal(calcProfitabilityPct(100, null), null);
});
