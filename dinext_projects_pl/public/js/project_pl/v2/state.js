export function initState(frm) {
	if (!frm.pl_v2) {
		frm.pl_v2 = {
			table: null,
			rows: [],
			periods: [],
			summaryRows: [],
			expandedIds: [],
			container: null,
		};
	}
	return frm.pl_v2;
}

export function destroyTable(frm) {
	const state = frm.pl_v2;
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
