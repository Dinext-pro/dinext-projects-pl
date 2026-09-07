export function initState(frm) {
	if (!frm.project_budget) {
		frm.project_budget = {
			table: null,
			rows: [],
			periods: [],
			summaryRows: [],
			expandedIds: [],
			container: null,
		};
	}
	return frm.project_budget;
}

export function destroyTable(frm) {
	const state = frm.project_budget;
	if (state?.table?.destroy) {
		state.table.destroy();
	}
	if (state) {
		state.table = null;
		state.container = null;
		state._mountPromise = null;
		state._initPromise = null;
	}
}
