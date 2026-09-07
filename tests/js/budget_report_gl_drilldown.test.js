const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function moment(input) {
	if (input && typeof input === "object" && "year" in input) {
		const month = String(input.month + 1).padStart(2, "0");
		return {
			format() {
				return `${input.year}-${month}-01`;
			},
			clone() {
				return this;
			},
			endOf() {
				return {
					format() {
						return `${input.year}-${month}-28`;
					},
				};
			},
			add() {
				return this;
			},
		};
	}
	return {
		format() {
			return input;
		},
	};
}

const glModulePath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"budget_report",
	"drilldown",
	"gl.js"
);

const periodCellsPath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"budget_report",
	"period_cells.js"
);

function loadGlDrillModule() {
	const periodCellsCode = fs.readFileSync(periodCellsPath, "utf8");
	const glCode = fs.readFileSync(glModulePath, "utf8");
	const context = {
		frappe: {
			provide() {},
			query_report: {
				get_filter_values() {
					return {
						company: "Dinext",
						from_period: "2026-01-01",
						to_period: "2026-12-01",
						cost_center: ["CC-A"],
						business_area: ["BA-A"],
					};
				},
			},
			route_options: null,
			set_route() {},
			show_alert() {},
		},
		moment,
		cint(value, default_value) {
			const parsed = parseInt(value, 10);
			return Number.isNaN(parsed) ? default_value || 0 : parsed;
		},
		flt(value) {
			return parseFloat(value) || 0;
		},
		__(text) {
			return text;
		},
		dinext_projects_pl: {
			budget_plan_vs_forecast: {
				period_cells: {},
			},
		},
		console,
	};
	vm.createContext(context);
	vm.runInContext(periodCellsCode, context);
	vm.runInContext(glCode, context);
	const br = context.dinext_projects_pl.budget_plan_vs_forecast;
	br.__ = (text) => text;
	br.normalize_report_filter_array = (value) => (Array.isArray(value) ? value : value ? [value] : []);
	br.cleanup_budget_report_page_layout = () => {};
	br.maybe_show_allocation_gl_disclaimer = () => {};
	return br;
}

test("parse_gl_drilldown_period total_fct uses full filter period (TC-GL-04)", () => {
	const br = loadGlDrillModule();
	const period = br.parse_gl_drilldown_period("total_fct");
	assert.equal(period.from_date, "2026-01-01");
	assert.equal(period.to_date, "2026-12-01");
});

test("build_gl_route_options includes account subtree and dimensions (TC-GL-01/05)", () => {
	const br = loadGlDrillModule();
	const route = br.build_gl_route_options("Expense - TC", { from_date: "2026-04-01", to_date: "2026-04-30" }, [
		"TEST-PL-BVF-PRJ-A",
	]);
	assert.equal(route.account.length, 1);
	assert.equal(route.account[0], "Expense - TC");
	assert.equal(route.from_date, "2026-04-01");
	assert.equal(route.to_date, "2026-04-30");
	assert.deepEqual(route.project, ["TEST-PL-BVF-PRJ-A"]);
	assert.deepEqual(route.cost_center, ["CC-A"]);
	assert.deepEqual(route.business_area, ["BA-A"]);
	assert.equal(route.include_default_book_entries, 1);
});
