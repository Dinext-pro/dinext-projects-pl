import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DELTA_MODE_ABS,
	DELTA_MODE_PCT,
	normalizeDeltaMode,
	resolveDeltaValue,
} from "../../dinext_projects_pl/public/js/project_budget/delta-mode.js";

test("normalizeDeltaMode defaults to pct", () => {
	assert.equal(normalizeDeltaMode(undefined), DELTA_MODE_PCT);
	assert.equal(normalizeDeltaMode("pct"), DELTA_MODE_PCT);
	assert.equal(normalizeDeltaMode("abs"), DELTA_MODE_ABS);
});

test("resolveDeltaValue pct uses stored percent", () => {
	assert.equal(
		resolveDeltaValue({ plan: 100, actual: 150, storedPct: 50, mode: "pct" }),
		50
	);
	assert.equal(
		resolveDeltaValue({ plan: 100, actual: 150, storedPct: 0, mode: "pct" }),
		0
	);
	assert.equal(
		resolveDeltaValue({ plan: 100, actual: 150, storedPct: null, mode: "pct" }),
		null
	);
});

test("resolveDeltaValue abs is actual minus plan", () => {
	assert.equal(
		resolveDeltaValue({ plan: 100, actual: 150, storedPct: 50, mode: "abs" }),
		50
	);
	assert.equal(
		resolveDeltaValue({ plan: 0, actual: 80, storedPct: 0, mode: "abs" }),
		80
	);
	assert.equal(
		resolveDeltaValue({ plan: 200, actual: 50, storedPct: -75, mode: "abs" }),
		-150
	);
});

test("resolveDeltaValue abs null when both sides missing", () => {
	assert.equal(
		resolveDeltaValue({ plan: null, actual: null, storedPct: null, mode: "abs" }),
		null
	);
});
