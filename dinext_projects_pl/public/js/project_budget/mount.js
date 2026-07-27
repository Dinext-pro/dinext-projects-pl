import { initState } from "./state.js";
import { reloadTable } from "./data.js";
import { initTable, refreshRuntime } from "./table.js";

const TABLE_CLASS = "budget-table";
const FIELD = "custom_planning";

function resolveTableContainer(wrapper) {
	let $table = wrapper.find(`.${TABLE_CLASS}`).first();
	if (!$table.length) {
		$table = $(`<div class="${TABLE_CLASS}"></div>`).appendTo(wrapper);
	}

	const el = $table[0];
	if (el) {
		el.style.height = "min(50vh, 560px)";
		el.style.minHeight = "280px";
		el.style.width = "100%";
	}
	return el || null;
}

/** Mount DinextTable into `.budget-table`. Caller must ensure tab is visible. */
export async function ensureMounted(frm) {
	const field = frm.get_field(FIELD);
	if (!field?.$wrapper?.length) {
		return;
	}

	const container = resolveTableContainer(field.$wrapper);
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
			window.ProjectBudget?.refreshChart?.(frm);
		} finally {
			state._mountPromise = null;
		}
	})();

	return state._mountPromise;
}
