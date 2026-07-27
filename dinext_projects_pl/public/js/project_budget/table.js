import { MERGE_GROUP } from "./constants.js";
import { initState } from "./state.js";
import { loadGridData, reloadTable } from "./data.js";
import { applyPlanDeltaVisibility, getColumns, refreshColumns } from "./columns.js";
import { attachTreePersistence, getExpandedIds, syncExpandedIds } from "./tree.js";
import { onSaveCells, onValidateCells } from "./save.js";
import { buildToolbarItems } from "./toolbar.js";

function buildTableOptions(frm, state) {
	return {
		container: state.container,
		data: state.rows,
		columns: getColumns(frm, state.periods),
		summaryRows: state.summaryRows || [],
		summary: { pin: "bottom", edit: false, clipboard: false, selection: false },
		expandedIds: getExpandedIds(frm),
		edit: true,
		selection: { enabled: true },
		// Excel UX: TSV copy/paste + fill-handle (same as WE v2).
		clipboard: { enabled: true },
		fillHandle: { enabled: true },
		// Excel-like Average | Count | Sum under grid (min 2 cells).
		selectionStatus: { enabled: true },
		// Checkbox select for «Сохранить план»; each bucket row independently.
		rowCheck: { enabled: true, unit: "row", selectAll: true },
		canCheckRow: ({ row }) => !row?.summary_kind && !!row?.account,
		rowReorder: { enabled: false },
		toolbar: {
			persistKey: `project-budget:${frm.doc?.name || "new"}`,
			items: buildToolbarItems(frm),
		},
		theme: {
			cellHorizontalPadding: 2,
			columnBorder: true,
			headerColumnBorder: true,
			rowBorder: true,
			headerRowBorder: true,
			wrapperBorder: true,
			pinnedColumnBorder: true,
			pinnedRowBorder: true,
		},
		onValidateCells: (ctx) => onValidateCells(frm, ctx),
		onSaveCells: (ctx) => onSaveCells(frm, ctx),
		mergeGroup: MERGE_GROUP,
		gridOptions: {
			// Needed for Статья merge when «Показать измерения»; ok when off.
			enableCellSpan: true,
			// Legacy: row ~29px, header block ~45px total.
			rowHeight: 29,
			headerHeight: 22,
			groupHeaderHeight: 22,
		},
		// Fullscreen: core default (target: container). Domain controls live in toolbar.
	};
}

function applyRuntime(frm, table) {
	attachTreePersistence(frm, table);
	syncExpandedIds(frm);
}

export async function initTable(frm) {
	const state = initState(frm);

	if (!state.container) {
		return null;
	}
	if (state.table) {
		return state.table;
	}
	if (state._initPromise) {
		return state._initPromise;
	}

	state._initPromise = (async () => {
		try {
			// doctype_css can lag behind boot cache — require CSS with the bundle.
			await frappe.require([
				"dinext-table.bundle.js",
				"/assets/dinext_projects_pl/css/project_budget.css",
			]);
			await loadGridData(frm);

			if (state.table) {
				return state.table;
			}

			const table = await DinextTable.create(buildTableOptions(frm, state));
			state.table = table;
			applyRuntime(frm, table);
			return table;
		} finally {
			state._initPromise = null;
		}
	})();

	return state._initPromise;
}

export async function refreshRuntime(frm) {
	const state = frm.project_budget;
	if (!state?.table) {
		return;
	}

	syncExpandedIds(frm);

	if (state.table.setOption) {
		state.table.setOption("columns", getColumns(frm, state.periods));
	}
	if (state.table.setSummaryRows) {
		state.table.setSummaryRows(state.summaryRows || []);
	}
	if (state.table.refresh) {
		state.table.refresh(state.rows);
	}
}

/** Toggle «План» / «Δ»: rebuild columns + leaf widths (no data reload). */
export function onTogglePlanOrDelta(frm) {
	applyPlanDeltaVisibility(frm);
}

/** View options change actual/forecast mapping → reload grid + chart. */
export async function onViewOptionsChange(frm) {
	const table = await reloadTable(frm, initTable, refreshRuntime);
	if (window.ProjectBudget?.refreshChart) {
		window.ProjectBudget.refreshChart(frm);
	}
	return table;
}

/** Period granularity or fact-aggregation toggle → reload grid + chart. */
export async function onPeriodOrAggregateChange(frm) {
	const table = await reloadTable(frm, initTable, refreshRuntime);
	if (window.ProjectBudget?.refreshChart) {
		window.ProjectBudget.refreshChart(frm);
	}
	return table;
}

/** Toggle «Показать / Скрыть измерения» → remount (column + merge span change). */
export async function onToggleDimensions(frm) {
	const state = frm.project_budget;
	const container = state?.container;
	if (state?.table?.destroy) {
		state.table.destroy();
	}
	if (state) {
		state.table = null;
		state._initPromise = null;
		if (container) {
			state.container = container;
		}
	}
	const table = await reloadTable(frm, initTable, refreshRuntime);
	if (window.ProjectBudget?.refreshChart) {
		window.ProjectBudget.refreshChart(frm);
	}
	return table;
}

export { applyPlanDeltaVisibility, refreshColumns, reloadTable };
