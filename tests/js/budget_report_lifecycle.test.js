const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { setImmediate: drainImmediate } = require("node:timers/promises");
const vm = require("node:vm");

const lifecycle = fs.readFileSync(
	path.resolve(__dirname, "../../dinext_projects_pl/public/js/budget_report/lifecycle.js"),
	"utf8"
);

test("releasing the P&L table cancels its queued resize", async () => {
	const window = new EventTarget();
	const stylesheet = { cssRules: [] };
	const styleElement = { sheet: stylesheet };
	const resizeSheets = [];
	let pendingResize;
	function onWindowResize() {
		if (resizeSheets.length === 0) {
			resizeSheets.push(styleElement.sheet);
		} else {
			pendingResize = setImmediate(() => resizeSheets.push(styleElement.sheet));
		}
	}
	onWindowResize.cancel = () => clearImmediate(pendingResize);
	window.addEventListener("resize", onWindowResize);

	const table = {
		style: { onWindowResize },
		destroy() {
			styleElement.sheet = null;
			window.removeEventListener("resize", onWindowResize);
		},
	};
	const budgetReport = { _budget_datatable: table };
	const queryReport = { datatable: table };
	vm.runInNewContext(lifecycle, {
		frappe: { provide() {}, query_report: queryReport },
		dinext_projects_pl: { budget_plan_vs_forecast: budgetReport },
		$: () => ({ removeClass() {} }),
	});

	window.dispatchEvent(new Event("resize"));
	window.dispatchEvent(new Event("resize"));
	assert.deepEqual(resizeSheets, [stylesheet]);

	budgetReport.destroy_budget_datatable();
	window.dispatchEvent(new Event("resize"));
	await drainImmediate();

	assert.deepEqual(resizeSheets, [stylesheet]);
	assert.equal(styleElement.sheet, null);
	assert.equal(budgetReport._budget_datatable, null);
	assert.equal(queryReport.datatable, null);
});

test("P&L releases the owned table before native replacement, without touching option probes", () => {
	const optionsModule = fs.readFileSync(
		path.resolve(__dirname, "../../dinext_projects_pl/public/js/budget_report/datatable_options.js"),
		"utf8"
	);
	let destroyed = false;
	const oldTable = { destroy() { destroyed = true; } };
	const budgetReport = { _budget_datatable: oldTable };
	const queryReport = { datatable: oldTable };
	const context = vm.createContext({
		frappe: { provide() {}, query_report: queryReport },
		dinext_projects_pl: { budget_plan_vs_forecast: budgetReport },
		$: () => ({ removeClass() {} }),
	});
	vm.runInContext(lifecycle, context);
	vm.runInContext(optionsModule, context);

	budgetReport.get_datatable_options({});
	assert.equal(destroyed, false);
	assert.equal(queryReport.datatable, oldTable);

	const foreignTable = {};
	queryReport.datatable = foreignTable;
	budgetReport.get_datatable_options({ data: [], columns: [] });
	assert.equal(destroyed, false);
	assert.equal(queryReport.datatable, foreignTable);

	queryReport.datatable = oldTable;
	const options = budgetReport.get_datatable_options({ data: [], columns: [] });
	assert.equal(destroyed, true);
	assert.equal(queryReport.datatable, null);
	assert.equal(options.showTotalRow, true);
});
