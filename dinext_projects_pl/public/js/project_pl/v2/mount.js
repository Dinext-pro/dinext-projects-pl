import { initState } from "./state.js";
import { reloadTable } from "./data.js";
import { initTable, refreshRuntime } from "./table.js";

const TABLE_CLASS = "budget-table";

function resolveTableContainer(wrapper) {
	let $table = wrapper.find(`.${TABLE_CLASS}`).first();
	if (!$table.length) {
		$table = $(`<div class="${TABLE_CLASS}"></div>`);
		const $controls = wrapper.find(".budget-controls").first();
		if ($controls.length) {
			$controls.after($table);
		} else {
			wrapper.append($table);
		}
	}

	const el = $table[0];
	if (el) {
		el.style.height = "min(50vh, 560px)";
		el.style.minHeight = "280px";
		el.style.width = "100%";
	}
	return el || null;
}

export async function ensureMounted(frm) {
	const field = frm.get_field("custom_planning");
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
			window.ProjectPlV2?.refreshChart?.(frm);
		} finally {
			state._mountPromise = null;
		}
	})();

	return state._mountPromise;
}
