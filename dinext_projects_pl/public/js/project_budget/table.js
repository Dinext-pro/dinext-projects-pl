import { initState } from "./state.js";
import { loadGridData, reloadTable } from "./data.js";
import { applyPlanDeltaVisibility, getColumns, refreshColumns } from "./columns.js";
import { attachTreePersistence, getExpandedIds, syncExpandedIds } from "./tree.js";
import { onSaveCells, onValidateCells } from "./save.js";
import { buildToolbarItems } from "./toolbar.js";
import {
	ensurePlDefaults,
	start_fullscreen_overlay_watch,
	stop_fullscreen_overlay_watch,
	bring_overlays_into_fullscreen,
} from "./controls.js";

const FS_SHELL_CLASS = "budget-container--fullscreen";

/** Fullscreen shell = .budget-container (controls + table), like WR. */
function resolveFullscreenOpts(container) {
	const shell = container?.closest?.(".budget-container");
	if (!shell) {
		return null;
	}

	const afterLayout = () => {
		requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
		});
	};

	return {
		target: "shell",
		shell,
		onEnter: ({ element }) => {
			element?.classList.add(FS_SHELL_CLASS);
			if (container) {
				container.dataset.plV2PrevHeight = container.style.height || "";
				container.dataset.plV2PrevMinHeight = container.style.minHeight || "";
				container.style.height = "auto";
				container.style.minHeight = "0";
				container.style.flex = "1 1 auto";
			}
			afterLayout();
		},
		onExit: ({ element }) => {
			element?.classList.remove(FS_SHELL_CLASS);
			if (container) {
				container.style.height = container.dataset.plV2PrevHeight || "min(50vh, 560px)";
				container.style.minHeight = container.dataset.plV2PrevMinHeight || "280px";
				container.style.flex = "";
				delete container.dataset.plV2PrevHeight;
				delete container.dataset.plV2PrevMinHeight;
			}
			afterLayout();
		},
	};
}

function bindFullscreenOverlayPortal(options) {
	const prevEnter = options.onFullscreenEnter;
	const prevExit = options.onFullscreenExit;
	options.onFullscreenEnter = (ctx) => {
		if (typeof prevEnter === "function") prevEnter(ctx);
		start_fullscreen_overlay_watch();
		bring_overlays_into_fullscreen();
	};
	options.onFullscreenExit = (ctx) => {
		if (typeof prevExit === "function") prevExit(ctx);
		stop_fullscreen_overlay_watch();
	};
}

function buildTableOptions(frm, state) {
	ensurePlDefaults(frm);
	const opts = {
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
		treeColumnField: "account_label",
		gridOptions: {
			// Legacy: row ~29px, header block ~45px total.
			rowHeight: 29,
			headerHeight: 22,
			groupHeaderHeight: 22,
			suppressMovableColumns: true,
		},
		// Fullscreen: core default (target: container). Domain controls live in toolbar.
	};

	const fullscreen = resolveFullscreenOpts(state.container);
	if (fullscreen) {
		opts.fullscreen = fullscreen;
	}
	bindFullscreenOverlayPortal(opts);
	return opts;
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

export { applyPlanDeltaVisibility, refreshColumns, reloadTable };
