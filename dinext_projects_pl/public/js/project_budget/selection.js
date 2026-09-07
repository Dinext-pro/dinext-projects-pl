import { PERIOD_FIELD_RE, SAVE_PLAN_API } from "./constants.js";
import { flattenTree, validatePlanWrites } from "./budget-tree.js";

function isSavableRow(row) {
	return !!(row && !row.summary_kind && row.account);
}

function rowGroupKey(row) {
	return JSON.stringify([row.account, row.dimensions || []]);
}

function targetDedupeKey(row, periodKey) {
	return `${row.id || rowGroupKey(row)}\0${periodKey}`;
}

/** Selected body rows (rowCheck), exclude summary / non-account. */
export function getSelectedRows(frm) {
	const table = frm.project_budget?.table;
	if (!table?.getCheckedRows) {
		return [];
	}
	return table.getCheckedRows().filter(isSavableRow);
}

/** Period key from field like plan_2026_1 / actual_2026_1; null for non-period cols. */
function periodKeyFromField(field) {
	if (!field || !PERIOD_FIELD_RE.test(field)) {
		return null;
	}
	return field.replace(PERIOD_FIELD_RE, "");
}

/**
 * Period cells inside current cell ranges → { row, period }[].
 * Uses DinextTable getCellRanges + api (same geometry as WE / status bar).
 */
function getSelectedPeriodCellTargets(frm) {
	const table = frm.project_budget?.table;
	const api = table?.api;
	if (!table?.getCellRanges || !api?.getAllDisplayedColumns) {
		return [];
	}

	const ranges = table.getCellRanges();
	if (!ranges?.length) {
		return [];
	}

	const periodByKey = new Map((frm.project_budget?.periods || []).map((p) => [p.key, p]));
	if (!periodByKey.size) {
		return [];
	}

	const columns = api.getAllDisplayedColumns();
	const targets = [];
	const seen = new Set();

	for (const range of ranges) {
		const bounds = table.buildRangeBounds?.(range, columns);
		if (!bounds) {
			continue;
		}

		for (let rowIndex = bounds.minRowIndex; rowIndex <= bounds.maxRowIndex; rowIndex += 1) {
			const rowNode = api.getDisplayedRowAtIndex(rowIndex);
			const row = rowNode?.data;
			if (!isSavableRow(row)) {
				continue;
			}
			if (table.shouldApplySelectionToRow && !table.shouldApplySelectionToRow(rowNode)) {
				continue;
			}

			for (let colIndex = bounds.minColIndex; colIndex <= bounds.maxColIndex; colIndex += 1) {
				if (table.getCellRangeState && !table.getCellRangeState(rowIndex, colIndex).inRange) {
					continue;
				}

				const field = columns[colIndex]?.getColDef()?.field;
				const periodKey = periodKeyFromField(field);
				if (!periodKey || !periodByKey.has(periodKey)) {
					continue;
				}

				const dedupe = targetDedupeKey(row, periodKey);
				if (seen.has(dedupe)) {
					continue;
				}
				seen.add(dedupe);
				targets.push({ row, period: periodByKey.get(periodKey) });
			}
		}
	}

	return targets;
}

function tryAddPlanAmount(groups, seen, row, period) {
	if (!isSavableRow(row) || !period?.key) {
		return;
	}

	const key = period.key;
	const dedupe = targetDedupeKey(row, key);
	if (seen.has(dedupe)) {
		return;
	}
	seen.add(dedupe);

	const currentPlan = Number(row[`own_plan_${key}`] ?? 0);
	const newPlanValue = period.is_past
		? Number(row[`own_fact_${key}`] ?? 0)
		: Number(row[`own_forecast_${key}`] ?? row[`forecast_${key}`] ?? 0);

	if (newPlanValue === currentPlan) {
		return;
	}

	const groupKey = rowGroupKey(row);
	let group = groups.get(groupKey);
	if (!group) {
		group = {
			account: row.account,
			dimensions: row.dimensions || [],
			amounts: [],
		};
		groups.set(groupKey, group);
	}
	group.amounts.push({
		year: period.year,
		month: period.month,
		plan_value: newPlanValue,
	});
}

/** True when row checkboxes and/or period cell ranges provide save-plan targets. */
export function hasSavePlanSelection(frm) {
	return getSelectedRows(frm).length > 0 || getSelectedPeriodCellTargets(frm).length > 0;
}

/**
 * Union: checked rows × all periods + selected period cells.
 * Diff only (skip 0→0). Zero is a valid new plan value.
 */
export function buildSavePlanPayload(frm) {
	const periods = frm.project_budget?.periods || [];
	const flat = flattenTree(frm.project_budget?.rows || []);
	const selectedIds = new Set(getSelectedRows(frm).map((row) => row.id).filter(Boolean));
	const cellTargets = getSelectedPeriodCellTargets(frm);
	const groups = new Map();
	const seen = new Set();

	if (selectedIds.size) {
		for (const row of flat) {
			if (!selectedIds.has(row.id)) {
				continue;
			}
			for (const period of periods) {
				tryAddPlanAmount(groups, seen, row, period);
			}
		}
	}

	for (const { row, period } of cellTargets) {
		tryAddPlanAmount(groups, seen, row, period);
	}

	return [...groups.values()].filter((group) => group.amounts.length);
}

async function executeSavePlan(frm, data) {
	const res = await frappe.xcall(SAVE_PLAN_API, {
		project: frm.doc.name,
		data: JSON.stringify(data),
	});
	if (res?.exc) {
		throw new Error(res.exc);
	}

	const mode = res?.mode || "approval";
	const successMessage =
		mode === "direct" ? __("Plan saved") : __("Budgets submitted for approval");

	frappe.show_alert(successMessage, 5);

	if (typeof load_and_render_project_dashboard === "function") {
		load_and_render_project_dashboard(frm);
	}
	if (window.ProjectBudget?.refresh) {
		await window.ProjectBudget.refresh(frm);
	}
}

/**
 * Save plan for checked rows and/or selected period cells. Confirm once, then save.
 */
export function saveForecastAsPlan(frm) {
	if ((frm._pl_period_type || "month") !== "month") {
		frappe.msgprint(
			__("Saving plan is available only in monthly display mode.")
		);
		return;
	}

	if (!hasSavePlanSelection(frm)) {
		frappe.msgprint(
			__("Select rows and/or period cells for which plan data should be saved.")
		);
		return;
	}

	const data = buildSavePlanPayload(frm);
	if (!data.length) {
		frappe.msgprint(__("No changes to save."));
		return;
	}

	const limitError = validatePlanWrites(frm.project_budget?.rows || [], data);
	if (limitError) {
		frappe.msgprint(limitError);
		return;
	}

	frappe.confirm(
		__(
			"Are you sure you want to save the selected forecast / actual data as plan (checked rows and selected cells)?"
		),
		() => {
			executeSavePlan(frm, data).catch((err) => {
				frappe.msgprint(__("Error saving plan"));
				console.error(err);
			});
		},
		() => frappe.show_alert(__("Operation cancelled"), 3)
	);
}
