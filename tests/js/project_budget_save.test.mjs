import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildSavePayload,
	onSaveCells,
	onValidateCells,
	resolveNoOpDisplayValue,
	restoreNoOpDisplay,
} from "../../dinext_projects_pl/public/js/project_budget/save.js";

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

test("buildSavePayload writes typed 0 as own, skips empty clear", () => {
	assert.deepEqual(values(buildSavePayload([change({ oldValue: null, newValue: 0 })])), [0]);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: undefined, newValue: "" })])), []);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: "", newValue: 0 })])), [0]);
	assert.deepEqual(
		values(
			buildSavePayload([
				change({
					oldValue: 0,
					newValue: 0,
					row: { account: "Acc-1", dimensions: [], own_forecast_2026_8: 0 },
				}),
			]),
		),
		[],
	);
	assert.deepEqual(
		values(
			buildSavePayload([
				change({
					oldValue: 5,
					newValue: 5,
					row: { account: "Acc-1", dimensions: [], own_forecast_2026_8: 5 },
				}),
			]),
		),
		[],
	);
});

test("buildSavePayload typed 0 stays own, empty editor clears own", () => {
	const ownRow = { account: "Acc-1", dimensions: [], own_forecast_2026_8: 5 };
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 5, newValue: 0, row: ownRow })])), [0]);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 5, newValue: "", row: ownRow })])), [null]);
	assert.equal(buildSavePayload([change({ oldValue: 5, newValue: "", row: ownRow })])[0].clear, true);
});

test("buildSavePayload keeps 0→5 write", () => {
	assert.deepEqual(values(buildSavePayload([change({ oldValue: 0, newValue: 5 })])), [5]);
	assert.deepEqual(values(buildSavePayload([change({ oldValue: null, newValue: 5 })])), [5]);
});

test("buildSavePayload skips empty parent clear, writes typed 0", () => {
	const parent = {
		account: "Расходы - Подрядчики",
		dimensions: [],
		summary_kind: null,
		children: [{ account: "Child" }],
	};
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: null, newValue: 0, row: parent })])),
		[0],
	);
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 0, newValue: "", row: parent })])),
		[],
	);
});

test("buildSavePayload writes typed 0 over rollup, skips empty editor on rollup", () => {
	const parent = {
		account: "Подрядчики - Dinext",
		dimensions: [],
		summary_kind: null,
		actual_2026_8: 3539,
		children: [{ account: "Child" }],
	};
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 3539, newValue: 0, row: parent })])),
		[0],
	);
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 3539, newValue: "", row: parent })])),
		[],
	);
});

test("buildSavePayload keeps parent write when own is 0 and editor has a value", () => {
	const parent = {
		account: "Подрядчики - Dinext",
		dimensions: [],
		own_forecast_2026_8: 0,
		actual_2026_8: 0,
	};
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 0, newValue: 100, row: parent })])),
		[100],
	);
});

test("buildSavePayload keeps parent own delete even if display equals own", () => {
	const parent = {
		account: "Подрядчики - Dinext",
		dimensions: [],
		own_forecast_2026_8: 200,
		actual_2026_8: 200,
	};
	assert.deepEqual(
		values(buildSavePayload([change({ oldValue: 200, newValue: 0, row: parent })])),
		[0],
	);
});

test("buildSavePayload drops no-ops from mixed batch", () => {
	const payload = buildSavePayload([
		change({ oldValue: null, newValue: "" }),
		change({ oldValue: 5, newValue: 0, row: { account: "Acc-2", dimensions: [] } }),
	]);
	assert.equal(payload.length, 1);
	assert.equal(payload[0].account, "Acc-2");
	assert.equal(payload[0].value, 0);
});

test("resolveNoOpDisplayValue restores 0 after empty editor", () => {
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: 0, newValue: "" })), 0);
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: 0, newValue: null })), 0);
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: "0", newValue: "" })), 0);
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: null, newValue: "" })), 0);
});

test("resolveNoOpDisplayValue keeps parent rollup display", () => {
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: 3539, newValue: "" })), 3539);
	assert.equal(resolveNoOpDisplayValue(change({ oldValue: 3539, newValue: 0 })), 3539);
});

test("restoreNoOpDisplay paints 0 back, does not write own", () => {
	const row = {
		id: "leaf-1",
		account: "Acc-1",
		own_forecast_2026_8: null,
		actual_2026_8: null,
	};
	restoreNoOpDisplay(
		{ project_budget: { rows: [row] } },
		[change({ oldValue: 0, newValue: "", row })],
	);
	assert.equal(row.actual_2026_8, 0);
	assert.equal(row.own_forecast_2026_8, null);
});

test("restoreNoOpDisplay keeps parent rollup, does not write own 0", () => {
	const row = {
		id: "parent-1",
		account: "Подрядчики - Dinext",
		own_forecast_2026_8: null,
		actual_2026_8: 0,
	};
	restoreNoOpDisplay(
		{ project_budget: { rows: [row] } },
		[change({ oldValue: 3539, newValue: "", row })],
	);
	assert.equal(row.actual_2026_8, 3539);
	assert.equal(row.own_forecast_2026_8, null);
});

test("onSaveCells coalesces two deletes on one account into one API call", async () => {
	const row = {
		id: "leaf-1",
		account: "Acc-1",
		own_forecast_2026_8: 5,
		own_forecast_2026_9: 7,
		actual_2026_8: 5,
		actual_2026_9: 7,
	};
	const frm = { project_budget: { rows: [row] }, doc: { name: "PROJ" } };
	const prevFrappe = globalThis.frappe;
	const prevRefresh = globalThis.ProjectBudget;
	const prevDunder = globalThis.__;
	const payloads = [];
	globalThis.ProjectBudget = { refresh: async () => {} };
	globalThis.__ = (msg) => msg;
	globalThis.frappe = {
		__: (msg) => msg,
		xcall: async (_method, args) => {
			payloads.push(JSON.parse(args.changes));
			return { saved: 2 };
		},
		show_alert() {},
	};
	try {
		const [a, b] = await Promise.all([
			onSaveCells(frm, {
				changes: [change({ field: "actual_2026_8", oldValue: 5, newValue: "", row })],
			}),
			onSaveCells(frm, {
				changes: [change({ field: "actual_2026_9", oldValue: 7, newValue: "", row })],
			}),
		]);
		assert.equal(a, true);
		assert.equal(b, true);
		assert.equal(payloads.length, 1);
		assert.deepEqual(
			payloads[0].map((item) => [item.period_key, item.value, item.clear]),
			[
				["2026_8", null, true],
				["2026_9", null, true],
			],
		);
	} finally {
		globalThis.frappe = prevFrappe;
		globalThis.ProjectBudget = prevRefresh;
		globalThis.__ = prevDunder;
	}
});

test("onSaveCells no-op restores display without API", async () => {
	const leaf = {
		id: "leaf-1",
		account: "Acc-1",
		own_forecast_2026_8: null,
		actual_2026_8: null,
	};
	const parent = {
		id: "parent-1",
		account: "Подрядчики - Dinext",
		own_forecast_2026_8: null,
		actual_2026_8: 0,
	};
	const applied = [];
	const frm = { project_budget: { rows: [leaf, parent] }, doc: { name: "PROJ" } };
	const table = {
		applyExternalCellValues(items) {
			applied.push(...items);
		},
	};
	const prevFrappe = globalThis.frappe;
	let xcalls = 0;
	globalThis.frappe = {
		xcall: async () => {
			xcalls += 1;
			throw new Error("no-op must not save");
		},
		show_alert() {},
	};
	try {
		const leafOk = await onSaveCells(frm, {
			changes: [change({ oldValue: 0, newValue: "", row: leaf })],
			table,
		});
		const parentOk = await onSaveCells(frm, {
			changes: [change({ oldValue: 3539, newValue: "", row: parent })],
			table,
		});
		assert.equal(leafOk, true);
		assert.equal(parentOk, true);
		assert.equal(xcalls, 0);
		assert.equal(leaf.actual_2026_8, 0);
		assert.equal(leaf.own_forecast_2026_8, null);
		assert.equal(parent.actual_2026_8, 3539);
		assert.equal(parent.own_forecast_2026_8, null);
		assert.deepEqual(
			applied.map((item) => item.value),
			[0, 3539],
		);
	} finally {
		globalThis.frappe = prevFrappe;
	}
});

function brokenParentTree() {
	const team = {
		id: "team-1",
		account: "Внутренняя команда - Dinext",
		account_label: "Внутренняя команда",
		own_forecast_2026_7: 312333,
		forecast_2026_7: 312333,
		children: [],
	};
	const contractors = {
		id: "pod-1",
		account: "Подрядчики - Dinext",
		account_label: "Подрядчики",
		own_forecast_2026_7: 0,
		forecast_2026_7: 202777,
		children: [],
	};
	const parent = {
		id: "works-1",
		account: "Работы / услуги - Dinext",
		account_label: "Работы / услуги",
		own_forecast_2026_7: 102000,
		forecast_2026_7: 102000,
		children: [contractors, team],
	};
	return { parent, contractors, team, rows: [parent] };
}

function withValidateFrappe(run) {
	const prevFrappe = globalThis.frappe;
	const prevDunder = globalThis.__;
	const messages = [];
	globalThis.__ = (msg, args = []) =>
		msg.replace("{0}", args[0] ?? "").replace("{1}", args[1] ?? "");
	globalThis.frappe = {
		...(prevFrappe || {}),
		__: globalThis.__,
		msgprint(msg) {
			messages.push(msg);
		},
	};
	try {
		return run(messages);
	} finally {
		globalThis.frappe = prevFrappe;
		globalThis.__ = prevDunder;
	}
}

test("onValidateCells allows empty edit when parent maxAllowed is negative", () => {
	const { contractors, rows } = brokenParentTree();
	withValidateFrappe((messages) => {
		const ok = onValidateCells(
			{ project_budget: { rows } },
			{
				changes: [
					change({
						field: "actual_2026_7",
						oldValue: 202777,
						newValue: "",
						row: contractors,
					}),
				],
			},
		);
		assert.equal(ok, true);
		assert.deepEqual(messages, []);
	});
});

test("onValidateCells allows decrease when parent maxAllowed is negative", () => {
	const { team, rows } = brokenParentTree();
	withValidateFrappe((messages) => {
		const ok = onValidateCells(
			{ project_budget: { rows } },
			{
				changes: [
					change({
						field: "actual_2026_7",
						oldValue: 312333,
						newValue: 200000,
						row: team,
					}),
				],
			},
		);
		assert.equal(ok, true);
		assert.deepEqual(messages, []);
	});
});

test("onValidateCells allows write on empty cell under rolled parent", () => {
	const sibling = {
		id: "sib-1",
		account: "Уже заполнено",
		own_forecast_2026_8: 5000,
		forecast_2026_8: 5000,
		children: [],
	};
	const empty = {
		id: "empty-1",
		account: "Пустая статья",
		own_forecast_2026_8: null,
		forecast_2026_8: 0,
		children: [],
	};
	const parent = {
		id: "rev-1",
		account: "Работы / услуги (выручка) - Dinext",
		account_label: "Работы / услуги (выручка)",
		own_forecast_2026_8: null,
		forecast_2026_8: 5000,
		children: [sibling, empty],
	};
	withValidateFrappe((messages) => {
		const ok = onValidateCells(
			{ project_budget: { rows: [parent] } },
			{
				changes: [
					change({
						oldValue: 0,
						newValue: 1200,
						row: empty,
					}),
				],
			},
		);
		assert.equal(ok, true);
		assert.deepEqual(messages, []);
	});
});

test("onValidateCells still blocks increase past parent room", () => {
	const { contractors, rows } = brokenParentTree();
	withValidateFrappe((messages) => {
		const ok = onValidateCells(
			{ project_budget: { rows } },
			{
				changes: [
					change({
						field: "actual_2026_7",
						oldValue: 0,
						newValue: 1,
						row: contractors,
					}),
				],
			},
		);
		assert.equal(ok, false);
		assert.equal(messages.length, 1);
		assert.match(String(messages[0]), /Работы \/ услуги/);
		assert.doesNotMatch(String(messages[0]), /-/);
	});
});
