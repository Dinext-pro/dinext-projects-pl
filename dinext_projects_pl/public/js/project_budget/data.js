import { GRID_API } from "./constants.js";
import { initState } from "./state.js";

function applyGridResponse(frm, message) {
	const state = initState(frm);
	state.periods = message.periods || [];
	state.rows = message.rows || [];
	state.summaryRows = message.summary_rows || [];
	return message;
}

export async function loadGridData(frm) {
	const period_type = frm._pl_period_type || "month";

	try {
		const message = await frappe.xcall(GRID_API, {
			project: frm.doc.name,
			period_type,
			view_options: frm.budget_view_options || __("Forecast and actual"),
			show_dimensions: frm.bg_show_dimensions ? 1 : 0,
			aggregate_fact: frm.bg_aggregate_fact === false ? 0 : 1,
			show_task_hierarchy: frm.bg_show_task_hierarchy === false ? 0 : 1,
		});
		if (!message) {
			throw new Error("Empty grid response");
		}
		return applyGridResponse(frm, message);
	} catch (err) {
		console.error("[Project P&L] grid load failed", err);
		frappe.msgprint(__("Error loading P&L data"));
		throw err;
	}
}

export async function reloadTable(frm, initTable, refreshRuntime) {
	const state = frm.project_budget;
	if (!state?.container) {
		return null;
	}

	await loadGridData(frm);
	if (state.table) {
		await refreshRuntime(frm);
		return state.table;
	}
	return initTable(frm);
}
