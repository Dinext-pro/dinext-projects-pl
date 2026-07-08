const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectPlPath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"project_pl.js"
);

function loadProjectPlModule() {
	const source = fs.readFileSync(projectPlPath, "utf8");
	const context = {
		console,
		globalThis: {},
		sessionStorage: {
			getItem() {
				return null;
			},
			removeItem() {},
		},
		setTimeout() {},
		cint(value, default_value) {
			const parsed = parseInt(value, 10);
			return Number.isNaN(parsed) ? default_value || 0 : parsed;
		},
		__(text) {
			return text;
		},
		frappe: {
			provide(namespace) {
				const parts = namespace.split(".");
				let current = context;
				for (const part of parts) {
					current[part] = current[part] || {};
					current = current[part];
				}
			},
			router: {
				on() {},
			},
			get_route() {
				return [];
			},
			after_ajax() {},
			ui: {
				form: {
					on() {},
				},
			},
			utils: {
				escape_html(value) {
					return String(value || "");
				},
				scroll_to() {},
			},
			model: {
				scrub(value) {
					return String(value || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
				},
			},
			datetime: {
				month_start() {
					return "2026-01-01";
				},
				str_to_obj(value) {
					return new Date(value);
				},
			},
		},
		dinext_projects: {},
		dinext_projects_pl: {},
		cur_frm: null,
		document: {},
	};
	context.globalThis = context;
	context.$ = function () {
		return {
			length: 0,
			find() {
				return this;
			},
			first() {
				return this;
			},
			off() {
				return this;
			},
			one() {
				return this;
			},
			on() {
				return this;
			},
			tab() {
				return this;
			},
			hasClass() {
				return false;
			},
		};
	};
	context.$.extend = Object.assign;

	vm.createContext(context);
	vm.runInContext(source, context, { filename: projectPlPath });
	return context.dinext_projects_pl.project_pl_budget_dblclick;
}

function budget(overrides) {
	return {
		name: "BUDGET-1",
		project: "PROJ-1",
		docstatus: 1,
		workflow_state: "Approved",
		dinext_budget_account: "Expense - D",
		budget_against: "Project",
		task: "",
		dinext_budget_monthly_amounts: JSON.stringify({ "2026-01": "100", "2026-02": "0" }),
		...overrides,
	};
}

test("matches row total scope by account and project budget target", () => {
	const helpers = loadProjectPlModule();
	const scope = {
		project: "PROJ-1",
		account: "Expense - D",
		task: "",
		dimensions: [],
	};

	assert.equal(helpers.budget_matches_scope(budget({ name: "MATCH" }), scope), true);
	assert.equal(
		helpers.budget_matches_scope(budget({ name: "TASK", budget_against: "Task", task: "TASK-1" }), scope),
		false
	);
	assert.equal(helpers.budget_matches_scope(budget({ name: "OTHER", dinext_budget_account: "Income - D" }), scope), false);
});

test("matches column total scope by non-zero monthly approved amount", () => {
	const helpers = loadProjectPlModule();
	const januaryScope = { project: "PROJ-1", year: 2026, month: 1, dimensions: [] };
	const februaryScope = { project: "PROJ-1", year: 2026, month: 2, dimensions: [] };

	assert.equal(helpers.budget_matches_scope(budget({ name: "JAN" }), januaryScope), true);
	assert.equal(helpers.budget_matches_scope(budget({ name: "FEB-ZERO" }), februaryScope), false);
});

test("matches scoped row totals by accounting dimensions", () => {
	const helpers = loadProjectPlModule();
	const scope = {
		project: "PROJ-1",
		account: "Expense - D",
		dimensions: [{ doc: "Business Area", docname: "BA-1" }],
	};

	assert.equal(helpers.budget_matches_scope(budget({ business_area: "BA-1" }), scope), true);
	assert.equal(helpers.budget_matches_scope(budget({ business_area: "BA-2" }), scope), false);
});

test("builds route options constrained to matched budget names", () => {
	const helpers = loadProjectPlModule();
	const routeOptions = helpers.build_budget_list_route_options(["BUDGET-2", "BUDGET-1"], {
		project: "PROJ-1",
		account: "Expense - D",
		task: "TASK-1",
	});

	assert.equal(JSON.stringify(routeOptions.name), JSON.stringify(["in", ["BUDGET-2", "BUDGET-1"]]));
	assert.equal(routeOptions.project, "PROJ-1");
	assert.equal(routeOptions.dinext_budget_account, "Expense - D");
	assert.equal(routeOptions.budget_against, "Task");
	assert.equal(routeOptions.task, "TASK-1");
	assert.equal(routeOptions.workflow_state, "Approved");
	assert.equal(routeOptions.docstatus, 1);
});
