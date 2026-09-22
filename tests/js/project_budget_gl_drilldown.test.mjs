import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parseActualField,
	parsePlanField,
	collectGlAccounts,
	resolveGlDateRange,
	buildGlRouteOptions,
	onCellDoubleClicked,
	onCellEditingStarted,
	startedByTypingDigit,
} from "../../dinext_projects_pl/public/js/project_budget/navigation.js";

const periods = [
	{
		year: 2026,
		month: 1,
		key: "2026_1",
		is_past: true,
		monthly_keys: ["2026_1"],
	},
	{
		year: 2026,
		month: 7,
		key: "2026_7",
		is_past: true,
		monthly_keys: ["2026_7"],
	},
	{
		year: 2026,
		month: 12,
		key: "2026_12",
		is_past: false,
		monthly_keys: ["2026_12"],
	},
];

const quarterPeriod = {
	year: 2026,
	month: 4,
	quarter: 2,
	key: "2026_Q2",
	is_past: true,
	monthly_keys: ["2026_4", "2026_5", "2026_6"],
};

function makeFrm(rowOverrides = {}) {
	return {
		doc: {
			name: "HEAVY-SEED-PROJ",
			company: "Test Company",
			expected_start_date: "2024-10-01",
			expected_end_date: "2026-12-31",
		},
		docname: "HEAVY-SEED-PROJ",
		project_budget: {
			periods,
			rows: [
				{
					account: "Income - TC",
					task: null,
					actual_2026_7: 100,
					children: [{ account: "Services - TC", actual_2026_7: 40 }],
				},
				{ account: "Expense - TC", actual_2026_7: 50 },
			],
		},
		...rowOverrides,
	};
}

describe("parseActualField", () => {
	it("detects total column", () => {
		assert.deepEqual(parseActualField("actual_total"), { kind: "total" });
	});
	it("detects period actual", () => {
		assert.deepEqual(parseActualField("actual_2026_7"), { kind: "period", key: "2026_7" });
	});
	it("ignores plan", () => {
		assert.equal(parseActualField("plan_2026_7"), null);
	});
});

describe("parsePlanField", () => {
	it("detects total column", () => {
		assert.deepEqual(parsePlanField("plan_total"), { kind: "total" });
	});
	it("detects period plan", () => {
		assert.deepEqual(parsePlanField("plan_2026_7"), { kind: "period", key: "2026_7" });
	});
	it("ignores actual", () => {
		assert.equal(parsePlanField("actual_2026_7"), null);
	});
});

describe("resolveGlDateRange", () => {
	it("uses month bounds for past cell", () => {
		const frm = makeFrm();
		const range = resolveGlDateRange(frm, "actual_2026_7", periods);
		assert.deepEqual(range, {
			from_date: "2026-07-01",
			to_date: "2026-07-31",
			require_past: true,
			is_past: true,
		});
	});
	it("uses project dates for total column", () => {
		const frm = makeFrm();
		const range = resolveGlDateRange(frm, "actual_total", periods);
		assert.deepEqual(range, {
			from_date: "2024-10-01",
			to_date: "2026-12-31",
			require_past: false,
		});
	});
	it("uses quarterly monthly_keys span", () => {
		const range = resolveGlDateRange(makeFrm(), "actual_2026_Q2", [quarterPeriod]);
		assert.equal(range.from_date, "2026-04-01");
		assert.equal(range.to_date, "2026-06-30");
	});
});

describe("collectGlAccounts", () => {
	it("skips summary placeholders", () => {
		const accounts = collectGlAccounts([
			{ account: "Income - TC", children: [{ account: "Services - TC" }] },
			{ account: "pl-v2-profit", summary_kind: "profit" },
		]);
		assert.deepEqual(accounts, ["Income - TC", "Services - TC"]);
	});
});

describe("buildGlRouteOptions", () => {
	it("opens GL for past fact cell with account and month", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "Services - TC", actual_2026_7: 1500 },
			"actual_2026_7",
			periods
		);
		assert.equal(opts.company, "Test Company");
		assert.deepEqual(opts.account, ["Services - TC"]);
		assert.equal(opts.from_date, "2026-07-01");
		assert.equal(opts.to_date, "2026-07-31");
		assert.deepEqual(opts.project, ["HEAVY-SEED-PROJ"]);
		assert.deepEqual(opts.task, []);
	});
	it("passes task filter when row has task", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "Services - TC", task: "TASK-1", actual_2026_7: 10 },
			"actual_2026_7",
			periods
		);
		assert.deepEqual(opts.task, ["TASK-1"]);
	});
	it("skips future forecast shown in actual column", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "Services - TC", actual_2026_12: 99 },
			"actual_2026_12",
			periods
		);
		assert.equal(opts, null);
	});
	it("skips zero fact", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "Services - TC", actual_2026_7: 0 },
			"actual_2026_7",
			periods
		);
		assert.equal(opts, null);
	});
	it("total column uses project dates even if last period is future", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "Services - TC", actual_total: 200 },
			"actual_total",
			periods
		);
		assert.equal(opts.from_date, "2024-10-01");
		assert.equal(opts.to_date, "2026-12-31");
	});
	it("profit summary uses all tree accounts", () => {
		const frm = makeFrm();
		const opts = buildGlRouteOptions(
			frm,
			{ account: "pl-v2-profit", summary_kind: "profit", actual_2026_7: -5 },
			"actual_2026_7",
			periods
		);
		assert.deepEqual(opts.account, ["Income - TC", "Services - TC", "Expense - TC"]);
	});
});

describe("onCellDoubleClicked", () => {
	it("sets route_options and routes to General Ledger", () => {
		const calls = [];
		globalThis.frappe = {
			route_options: null,
			set_route(...args) {
				calls.push(args);
			},
		};
		const frm = makeFrm();
		onCellDoubleClicked(frm, {
			colDef: { field: "actual_2026_7" },
			data: { account: "Services - TC", actual_2026_7: 12 },
		});
		assert.equal(frappe.route_options.from_date, "2026-07-01");
		assert.deepEqual(calls[0], ["query-report", "General Ledger"]);
		delete globalThis.frappe;
	});

	it("opens Budget list on account / task row", () => {
		const calls = [];
		globalThis.frappe = {
			route_options: null,
			set_route(...args) {
				calls.push(args);
			},
		};
		onCellDoubleClicked(makeFrm(), {
			colDef: { field: "account_label" },
			data: { account: "Services - TC", account_label: "Services" },
		});
		assert.deepEqual(calls[0], ["List", "Budget"]);
		assert.deepEqual(frappe.route_options, {
			project: "HEAVY-SEED-PROJ",
			dinext_budget_account: "Services - TC",
			budget_against: "Project",
		});
		delete globalThis.frappe;
	});

	it("opens approved Budget on plan cell even if pb_docname is set", async () => {
		const calls = [];
		globalThis.frappe = {
			async xcall() {
				return "BUDGET-OK";
			},
			set_route(...args) {
				calls.push(args);
			},
			show_alert() {},
			__: (text) => text,
		};
		await onCellDoubleClicked(makeFrm(), {
			colDef: { field: "plan_2026_7" },
			data: {
				account: "Services - TC",
				dimensions: [],
				pb_docname: "PRBU-2026-00144",
				plan_2026_7: 220000,
			},
		});
		assert.deepEqual(calls[0], ["Form", "Budget", "BUDGET-OK"]);
		delete globalThis.frappe;
	});

	it("alerts when approved Budget is missing", async () => {
		const alerts = [];
		globalThis.frappe = {
			async xcall() {
				return null;
			},
			set_route() {
				throw new Error("should not route");
			},
			show_alert(msg) {
				alerts.push(msg);
			},
			__: (text) => text,
		};
		await onCellDoubleClicked(makeFrm(), {
			colDef: { field: "plan_2026_7" },
			data: { account: "Services - TC", dimensions: [], plan_2026_7: 100 },
		});
		assert.equal(alerts.length, 1);
		delete globalThis.frappe;
	});

	it("skips zero plan and plan_total", async () => {
		const calls = [];
		globalThis.frappe = {
			async xcall() {
				calls.push("xcall");
			},
			set_route(...args) {
				calls.push(args);
			},
		};
		await onCellDoubleClicked(makeFrm(), {
			colDef: { field: "plan_2026_7" },
			data: { account: "Services - TC", plan_2026_7: 0 },
		});
		await onCellDoubleClicked(makeFrm(), {
			colDef: { field: "plan_total" },
			data: { account: "Services - TC", plan_total: 900 },
		});
		assert.deepEqual(calls, []);
		delete globalThis.frappe;
	});
});

describe("onCellEditingStarted", () => {
	it("clears calculated forecast editor, keeps own value", () => {
		const frm = makeFrm();
		frm.project_budget.periods = periods;

		const calculatedInput = { value: "1500" };
		onCellEditingStarted(frm, {
			eGridCell: { querySelector: () => calculatedInput },
			colDef: { field: "actual_2026_12" },
			data: { account: "Services - TC" },
		});
		assert.equal(calculatedInput.value, "");

		const ownZeroInput = { value: "0" };
		onCellEditingStarted(frm, {
			eGridCell: { querySelector: () => ownZeroInput },
			colDef: { field: "actual_2026_12" },
			data: { account: "Services - TC", own_forecast_2026_12: 0 },
		});
		assert.equal(ownZeroInput.value, "0");

		const ownInput = { value: "400" };
		onCellEditingStarted(frm, {
			eGridCell: { querySelector: () => ownInput },
			colDef: { field: "actual_2026_12" },
			data: { account: "Services - TC", own_forecast_2026_12: 400 },
		});
		assert.equal(ownInput.value, "400");
	});

	it("keeps a digit typed to start edit on an empty forecast cell", () => {
		const frm = makeFrm();
		frm.project_budget.periods = periods;
		let setTo = "5";
		onCellEditingStarted(frm, {
			event: { key: "5" },
			colDef: { field: "actual_2026_12" },
			data: { account: "Services - TC" },
			api: {
				getCellEditorInstances: () => [
					{
						agSetEditValue: (value) => {
							setTo = value;
						},
					},
				],
			},
		});
		assert.equal(setTo, "5");
		assert.equal(startedByTypingDigit({ event: { key: "5" } }), true);
		assert.equal(startedByTypingDigit({ event: { key: "Enter" } }), false);
	});

	it("clears via agSetEditValue when eGridCell is missing", () => {
		const frm = makeFrm();
		frm.project_budget.periods = periods;
		let setTo;
		onCellEditingStarted(frm, {
			colDef: { field: "actual_2026_12" },
			data: { account: "Services - TC" },
			api: {
				getCellEditorInstances: () => [
					{
						agSetEditValue: (value) => {
							setTo = value;
						},
					},
				],
			},
		});
		assert.equal(setTo, null);
	});
});
