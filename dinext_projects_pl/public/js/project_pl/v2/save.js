import { SAVE_FORECAST_API } from "./constants.js";

function flattenTree(rows) {
	const result = [];
	for (const row of rows || []) {
		result.push(row);
		if (row.children?.length) {
			result.push(...flattenTree(row.children));
		}
	}
	return result;
}

function forecastOf(row, periodKey) {
	return Number(row?.[`forecast_${periodKey}`] ?? row?.[`actual_${periodKey}`] ?? 0);
}

function findParent(rows, childId, parent = null) {
	for (const row of rows || []) {
		if (row.id === childId) return parent;
		if (row.children?.length) {
			const found = findParent(row.children, childId, row);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

function childForecastSum(row, periodKey, excludeId = null) {
	let sum = 0;
	for (const child of row.children || []) {
		if (excludeId && child.id === excludeId) continue;
		const own = forecastOf(child, periodKey);
		if (own) {
			sum += own;
		} else {
			sum += childForecastSum(child, periodKey);
		}
	}
	return sum;
}

function parentForecastLimit(rows, row, periodKey) {
	let current = row;
	while (current) {
		const parent = findParent(rows, current.id);
		if (!parent) return null;
		const parentForecast = forecastOf(parent, periodKey);
		if (parentForecast > 0) {
			const siblings = childForecastSum(parent, periodKey, current.id);
			return {
				maxAllowed: parentForecast - siblings,
				parentLabel: parent.account_label || parent.account,
			};
		}
		current = parent;
	}
	return null;
}

function validateForecastChange(frm, change) {
	const field = change.field;
	if (!field?.startsWith("actual_")) return true;

	const periodKey = field.slice("actual_".length);
	const row = change.row;
	if (!row || row.summary_kind) return true;

	const value = Number(change.newValue || 0);
	const rows = frm.pl_v2?.rows || [];

	const childrenSum = childForecastSum(row, periodKey);
	if (childrenSum > 0 && value < childrenSum) {
		return __(
			"Значение не может быть меньше суммы по дочерним позициям ({0})",
			[Math.round(childrenSum).toLocaleString("ru-RU")]
		);
	}

	const parentLimit = parentForecastLimit(rows, row, periodKey);
	if (parentLimit !== null && value > parentLimit.maxAllowed) {
		return __(
			"Значение не может превышать {0} (ограничение родительской статьи '{1}')",
			[
				Math.round(parentLimit.maxAllowed).toLocaleString("ru-RU"),
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

function buildSavePayload(changes) {
	return changes
		.filter((change) => change.field?.startsWith("actual_") && !change.row?.summary_kind)
		.map((change) => {
			const periodKey = change.field.slice("actual_".length);
			const [year, month] = periodKey.split("_");
			const row = change.row || {};
			return {
				account: row.account,
				dimensions: row.dimensions || [],
				period_key: periodKey,
				year: Number(year),
				month: Number(month),
				value: Number(change.newValue || 0),
			};
		})
		.filter((item) => item.account);
}

function patchLocalForecast(frm, changes) {
	const flat = flattenTree(frm.pl_v2?.rows || []);
	for (const change of changes) {
		if (!change.field?.startsWith("actual_")) continue;
		const periodKey = change.field.slice("actual_".length);
		const row = flat.find((r) => r.id === change.row?.id);
		if (!row) continue;
		const value = Number(change.newValue || 0);
		row[`forecast_${periodKey}`] = value;
		row[`actual_${periodKey}`] = value;
	}
}

export async function onSaveCells(frm, { changes }) {
	const payload = buildSavePayload(changes);
	if (!payload.length) return true;

	const res = await frappe.xcall(SAVE_FORECAST_API, {
		project: frm.doc.name,
		changes: JSON.stringify(payload),
	});

	if (res?.exc) {
		throw new Error(res.exc);
	}

	frappe.show_alert(__("Данные успешно обновлены"), 5);
	patchLocalForecast(frm, changes);

	// Dual-table: refresh both grids from server + chart from v2.
	if (typeof load_budget_data === "function") {
		load_budget_data(frm, frm._pl_period_type || "month");
	}
	if (window.ProjectPlV2?.refresh) {
		await window.ProjectPlV2.refresh(frm);
	} else if (window.ProjectPlV2?.refreshChart) {
		window.ProjectPlV2.refreshChart(frm);
	}
	return true;
}
