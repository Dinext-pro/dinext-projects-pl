import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSavePayload } from "../../dinext_projects_pl/public/js/project_budget/save.js";

function change(overrides = {}) {
	return {
		field: "actual_2026_8",
		oldValue: 0,
		newValue: 0,
		row: { account: "Acc-1", dimensions: [], summary_kind: null },
		...overrides,
	};
}

function values(payload) {
	return payload.map((item) => item.value);
}

test("buildSavePayload skips empty/0→0", () => {
	assert.deepEqual(values(buildSavePayload([change({ oldValue: null, newValue: 0 })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: undefined, newValue: "" })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: "", newValue: 0 })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 0, newValue: 0 })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: "0", newValue: 0 })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 5, newValue: 5 })])), []);
});

test("buildSavePayload keeps 5→0 delete", () => {
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 5, newValue: 0 })])), [0]);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 5, newValue: "" })])), [0]);
});

test("buildSavePayload keeps 0→5 write", () => {
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 0, newValue: 5 })])), [5]);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: null, newValue: 5 })])), [5]);
});

test("buildSavePayload skips empty parent cell (forecast_only no-op)", () => {
	const parent = {
		account: "Расходы - Подрядчики",
		dimensions: [],
		summary_kind: null,
		children: [{ account: "Child" }],
	};
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: null, newValue: 0, row: parent })])),
		[],
	);
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 0, newValue: "", row: parent })])),
		[],
	);
});

test("buildSavePayload drops no-ops from mixed batch", () => {
	const payload = buildSavePayload([
		change({ oldValue: null, newValue: 0 }),
		change({ oldValue: 5, newValue: 0, row: { account: "Acc-2", dimensions: [] } }),
	]);
	assert.equal(payload.length, 1);
	assert.equal(payload[0].account, "Acc-2");
	assert.equal(payload[0].value, 0);
});
