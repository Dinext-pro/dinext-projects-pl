import { SAVE_FORECAST_API } from "./constants.js";
import {
	childForecastSum,
	flattenTree,
	parentForecastLimit,
} from "./budget-tree.js";
import { isMutationLocked } from "./controls.js";

function validateForecastChange(frm, change) {
	const field = change.field;
	if (!field?.startsWith("actual_")) return true;

	const periodKey = field.slice("actual_".length);
	const row = change.row;
	if (!row || row.summary_kind) return true;

	const value = toSaveAmount(change.newValue);
	const previous = toSaveAmount(previousForecastAmount(change));
	if (value === previous) return true;

	const rows = frm.project_budget?.rows || [];

	const childrenSum = childForecastSum(row, periodKey);
	if (value > 0 && childrenSum > 0 && value < childrenSum) {
		return __("Value cannot be less than the sum of child items ({0})",
			[Math.round(childrenSum).toLocaleString("ru-RU")]
		);
	}

	const parentLimit = parentForecastLimit(rows, row, periodKey);
	// Negative maxAllowed = parent own already < other children. Do not
	// block no-op / decrease (empty edit on 0 used to throw "-150000").
	if (
		parentLimit !== null
		&& value > parentLimit.maxAllowed
		&& value > previous
	) {
		const shownLimit = parentLimit.maxAllowed < 0 ? 0 : parentLimit.maxAllowed;
		return __("Value cannot exceed {0} (parent account '{1}' limit)",
			[
				Math.round(shownLimit).toLocaleString("ru-RU"),
				parentLimit.parentLabel,
			]
		);
	}

	return true;
}

export function onValidateCells(frm, { changes }) {
	for (const change of changes) {
		const result = validateForecastChange(frm, change);
		if (result !== true) {
			frappe.msgprint(result);
			return false;
		}
	}
	return true;
}

function toSaveAmount(value) {
	return Number(value || 0);
}

function isClearEditorValue(value) {
	return value === null || value === undefined || value === "";
}

function periodKeyOfChange(change) {
	const field = change.field || "";
	return field.startsWith("actual_") ? field.slice("actual_".length) : "";
}

/** Explicit own including 0. null/"" = empty cell (painted 0 / rollup). */
function ownForecastOf(change) {
	const periodKey = periodKeyOfChange(change);
	if (!periodKey) {
		return null;
	}
	const raw = change.row?.[`own_forecast_${periodKey}`];
	if (raw == null || raw === "") {
		return null;
	}
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/** Editable forecast, not displayed rollup (`actual_*` / DinextTable oldValue). */
function previousForecastAmount(change) {
	const own = ownForecastOf(change);
	if (own != null) {
		return own;
	}
	return change.oldValue;
}

function forecastEditorIntent(change) {
	if (isClearEditorValue(change.newValue)) {
		return { kind: "clear" };
	}
	return { kind: "set", value: toSaveAmount(change.newValue) };
}

/** Diff only. Typed 0 = own. Empty editor / Delete = clear own. */
export function buildSavePayload(changes) {
	return changes
		.filter((change) => change.field?.startsWith("actual_") && !change.row?.summary_kind)
		.filter((change) => {
			const intent = forecastEditorIntent(change);
			const own = ownForecastOf(change);
			if (intent.kind === "clear") {
				return own != null;
			}
			return own == null || intent.value !== own;
		})
		.map((change) => {
			const periodKey = change.field.slice("actual_".length);
			const [year, month] = periodKey.split("_");
			const row = change.row || {};
			const intent = forecastEditorIntent(change);
			const clearing = intent.kind === "clear";
			return {
				account: row.account,
				dimensions: row.dimensions || [],
				period_key: periodKey,
				year: Number(year),
				month: Number(month),
				value: clearing ? null : intent.value,
				clear: clearing,
			};
		})
		.filter((item) => item.account);
}

/** Pre-edit display. Empty editor after 0 / rollup must not stay blank. */
export function resolveNoOpDisplayValue(change) {
	if (change.oldValue != null && change.oldValue !== "") {
		const n = Number(change.oldValue);
		if (Number.isFinite(n)) return n;
	}
	return 0;
}

/** Restore `actual_*` only. Do not write `own_forecast_*` (parent rollup #6). */
export function restoreNoOpDisplay(frm, changes, table) {
	const restores = [];
	for (const change of changes || []) {
		if (!change.field?.startsWith("actual_") || change.row?.summary_kind) continue;
		restores.push({
			field: change.field,
			value: resolveNoOpDisplayValue(change),
			rowId: change.rowId,
			id: change.row?.id,
			row: change.row,
		});
	}

	if (typeof table?.applyExternalCellValues === "function") {
		table.applyExternalCellValues(
			restores.map(({ field, value, rowId, id }) => ({ field, value, rowId, id }))
		);
	}

	const flat = flattenTree(frm?.project_budget?.rows || []);
	for (const item of restores) {
		const row = (item.id != null && flat.find((r) => r.id === item.id)) || item.row;
		if (!row) continue;
		row[item.field] = item.value;
	}
}

function patchLocalForecast(frm, changes) {
	const flat = flattenTree(frm.project_budget?.rows || []);
	for (const change of changes) {
		if (!change.field?.startsWith("actual_")) continue;
		const periodKey = change.field.slice("actual_".length);
		const row = flat.find((r) => r.id === change.row?.id);
		if (!row) continue;
		if (isClearEditorValue(change.newValue)) {
			row[`own_forecast_${periodKey}`] = null;
			continue;
		}
		const value = toSaveAmount(change.newValue);
		row[`own_forecast_${periodKey}`] = value;
		row[`forecast_${periodKey}`] = value;
		row[`actual_${periodKey}`] = value;
	}
}

function changeDedupeKey(change) {
	return `${change.row?.id || change.rowId || change.row?.account || ""}::${change.field || ""}`;
}

function mergeSaveChanges(existing, incoming) {
	const byKey = new Map();
	for (const change of existing) {
		byKey.set(changeDedupeKey(change), change);
	}
	for (const change of incoming) {
		const key = changeDedupeKey(change);
		const prev = byKey.get(key);
		byKey.set(key, prev ? { ...prev, ...change, oldValue: prev.oldValue } : change);
	}
	return [...byKey.values()];
}

const SAVE_COALESCE_MS = 40;
const pendingSaves = new WeakMap();

async function persistForecastChanges(frm, changes, table) {
	if (isMutationLocked(frm)) {
		return false;
	}
	const payload = buildSavePayload(changes);
	if (!payload.length) {
		restoreNoOpDisplay(frm, changes, table);
		return true;
	}

	const res = await frappe.xcall(SAVE_FORECAST_API, {
		project: frm.doc.name,
		changes: JSON.stringify(payload),
	});

	if (res?.exc) {
		throw new Error(res.exc);
	}

	frappe.show_alert(__("Data updated successfully"), 5);
	patchLocalForecast(frm, changes);

	// Refresh DinextTable + chart after forecast save.
	const projectBudget = globalThis.ProjectBudget;
	if (projectBudget?.refresh) {
		await projectBudget.refresh(frm);
	} else if (projectBudget?.refreshChart) {
		projectBudget.refreshChart(frm);
	}
	return true;
}

async function flushPendingSave(frm) {
	const bucket = pendingSaves.get(frm);
	if (!bucket) {
		return;
	}
	pendingSaves.delete(frm);
	if (bucket.timer) {
		clearTimeout(bucket.timer);
	}
	try {
		const ok = await persistForecastChanges(frm, bucket.changes, bucket.table);
		for (const waiter of bucket.waiters) {
			waiter.resolve(ok);
		}
	} catch (err) {
		for (const waiter of bucket.waiters) {
			waiter.reject(err);
		}
	}
}

/** Coalesce rapid Delete/edit commits so one Project Budget is not saved twice. */
export function onSaveCells(frm, { changes, table }) {
	return new Promise((resolve, reject) => {
		let bucket = pendingSaves.get(frm);
		if (!bucket) {
			bucket = { changes: [], table, waiters: [], timer: null };
			pendingSaves.set(frm, bucket);
		}
		bucket.changes = mergeSaveChanges(bucket.changes, changes || []);
		bucket.table = table || bucket.table;
		bucket.waiters.push({ resolve, reject });
		if (bucket.timer) {
			clearTimeout(bucket.timer);
		}
		bucket.timer = setTimeout(() => {
			void flushPendingSave(frm);
		}, SAVE_COALESCE_MS);
	});
}
