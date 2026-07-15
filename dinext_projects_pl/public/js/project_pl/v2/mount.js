import { isPreviewEnabled, resolvePreviewContainer } from "./dual-preview-mount.js";
import { initState } from "./state.js";
import { reloadTable } from "./data.js";
import { initTable, refreshRuntime } from "./table.js";

export async function ensureMounted(frm) {
	if (!isPreviewEnabled(frm)) {
		return;
	}

	const field = frm.get_field("custom_planning");
	if (!field?.$wrapper?.length) {
		return;
	}

	const container = resolvePreviewContainer(frm, field.$wrapper);
	if (!container) {
		return;
	}

	const state = initState(frm);
	state.container = container;

	if (state._mountPromise) {
		return state._mountPromise;
	}

	state._mountPromise = (async () => {
		try {
			if (state.table) {
				await reloadTable(frm, initTable, refreshRuntime);
			} else {
				await initTable(frm);
			}
			// Chart prefers pl_v2 once grid is loaded (see chart-adapter).
			window.ProjectPlV2?.refreshChart?.(frm);
		} finally {
			state._mountPromise = null;
		}
	})();

	return state._mountPromise;
}
