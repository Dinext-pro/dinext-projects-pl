import { destroyTable } from "./state.js";
import { ensureMounted } from "./mount.js";
import { reloadTable } from "./data.js";
import {
	applyPlanDeltaVisibility,
	initTable,
	onTogglePlanOrDelta,
	onViewOptionsChange,
	refreshColumns,
	refreshRuntime,
} from "./table.js";
import {
	buildSavePlanPayload,
	getSelectedRows,
	saveForecastAsPlan,
} from "./selection.js";
import { buildChartData, refreshChart } from "./chart-adapter.js";

let ready = false;

const ProjectPlV2 = {
	isReady() {
		return ready;
	},

	ensureMounted,

	destroy(frm) {
		destroyTable(frm);
	},

	async refresh(frm) {
		const table = await reloadTable(frm, initTable, refreshRuntime);
		refreshChart(frm);
		return table;
	},

	refreshColumns,
	applyPlanDeltaVisibility,
	onTogglePlanOrDelta,
	onViewOptionsChange,
	getSelectedRows,
	buildSavePlanPayload,
	saveForecastAsPlan,
	buildChartData,
	refreshChart,
};

ready = true;
window.ProjectPlV2 = ProjectPlV2;

export { ProjectPlV2 };
