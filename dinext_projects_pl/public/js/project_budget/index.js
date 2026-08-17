import { installLazyTabMountApi } from "./lazy-tab-mount.js";
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
	hasSavePlanSelection,
	saveForecastAsPlan,
} from "./selection.js";
import { refreshForecastDropdown } from "./controls.js";
import { buildChartData, refreshChart } from "./chart-adapter.js";
import {
	accountAllowsTask,
	buildParentAdjustmentsFromUpdates,
	getBasisForecastMap,
	getDisplayPeriods,
	isBudgetReady,
} from "./budget-tree.js";

let ready = false;

const ProjectBudget = {
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
	hasSavePlanSelection,
	buildSavePlanPayload,
	saveForecastAsPlan,
	refreshForecastDropdown,
	buildChartData,
	refreshChart,

	/** Cross-app: risk reserves / WE parent-adjust (project_budget tree, no aggregatedBudget). */
	isBudgetReady,
	getDisplayPeriods,
	accountAllowsTask,
	getBasisForecastMap,
	buildParentAdjustments: buildParentAdjustmentsFromUpdates,
};

ready = true;
window.ProjectBudget = ProjectBudget;
installLazyTabMountApi();

export { ProjectBudget };
