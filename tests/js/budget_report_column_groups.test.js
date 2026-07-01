const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const columnGroupsModulePath = path.resolve(
	__dirname,
	"..",
	"..",
	"dinext_projects_pl",
	"public",
	"js",
	"budget_report",
	"column_groups.js"
);

function frappeProvide(namespace, root) {
	const parts = namespace.split(".");
	let current = root;
	for (const part of parts) {
		if (current[part] === undefined) {
			current[part] = {};
		}
		current = current[part];
	}
}

function loadColumnGroupsModule() {
	const context = {
		frappe: {
			provide(namespace) {
				frappeProvide(namespace, context);
			},
			query_report: {},
			datetime: {
				get_today() {
					return "2026-03-15";
				},
				str_to_obj(value) {
					const parts = String(value).split("-");
					return new Date(
						parseInt(parts[0], 10),
						parseInt(parts[1], 10) - 1,
						parseInt(parts[2], 10)
					);
				},
			},
		},
		cint(value, default_value) {
			const parsed = parseInt(value, 10);
			return Number.isNaN(parsed) ? default_value || 0 : parsed;
		},
		formatdate(value, format) {
			if (format === "MMM yyyy" && value === "2026-01-01") {
				return "Jan 2026";
			}
			return value;
		},
		__() {
			return arguments[0];
		},
		dinext_projects_pl: {
			budget_plan_vs_forecast: {},
		},
		console,
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(columnGroupsModulePath, "utf8"), context);
	const br = context.dinext_projects_pl.budget_plan_vs_forecast;
	br.__ = function (text) {
		return text;
	};
	br.get_budget_report_columns = function (report) {
		if (report && report.raw_data && report.raw_data.columns) {
			return report.raw_data.columns;
		}
		return (report && report.columns) || [];
	};
	return br.column_groups;
}

test("total_column_role_label strips total prefix from subcolumns", () => {
	const cg = loadColumnGroupsModule();

	assert.equal(
		cg.total_column_role_label({ fieldname: "total_plan", period_role: "plan" }),
		"Plan"
	);
	assert.equal(
		cg.total_column_role_label({ fieldname: "total_fct", period_role: "display" }),
		"Fact"
	);
	assert.equal(
		cg.total_column_role_label({ fieldname: "total_exp_fct", period_role: "display" }),
		"Forecast/Fact"
	);
});

test("get_column_group_key groups totals under total key", () => {
	const cg = loadColumnGroupsModule();

	assert.equal(
		cg.get_column_group_key({
			fieldname: "total_plan",
			period_group: "total",
		}),
		"total"
	);
	assert.equal(
		cg.get_column_group_key({
			fieldname: "total_exp_fct",
		}),
		"total"
	);
	assert.equal(
		cg.get_column_group_key({
			fieldname: "plan_2026_01",
			period_group: "2026_01",
		}),
		"2026_01"
	);
	assert.equal(cg.get_column_group_key({ fieldname: "account" }), null);
	assert.equal(
		cg.get_column_group_key({
			id: "plan_2026_01",
		}),
		"2026_01"
	);
});

test("enrich_column_group_metadata adds total group for total columns", () => {
	const cg = loadColumnGroupsModule();

	const enriched = cg.enrich_column_group_metadata({
		fieldname: "total_plan",
		label: "Total Plan",
	});

	assert.equal(enriched.period_group, "total");
	assert.equal(enriched.period_group_label, "Total");
	assert.equal(enriched.period_role, "plan");
});

test("get_report_columns_with_groups merges metadata from raw_data columns", () => {
	const cg = loadColumnGroupsModule();
	const report = {
		columns: [{ fieldname: "plan_2026_01", label: "Plan", hidden: 0 }],
		raw_data: {
			columns: [
				{
					fieldname: "plan_2026_01",
					period_group: "2026_01",
					period_group_label: "Jan 2026",
					period_role: "plan",
				},
			],
		},
	};

	const merged = cg.get_report_columns_with_groups(report);

	assert.equal(merged.length, 1);
	assert.equal(merged[0].period_group, "2026_01");
	assert.equal(merged[0].period_group_label, "Jan 2026");
});

test("is_current_period_group matches month quarter and year keys", () => {
	const cg = loadColumnGroupsModule();

	assert.equal(cg.is_current_period_group("2026_03"), true);
	assert.equal(cg.is_current_period_group("2026_01"), false);
	assert.equal(cg.is_current_period_group("2026_Q1"), true);
	assert.equal(cg.is_current_period_group("2026_Q2"), false);
	assert.equal(cg.is_current_period_group("2026"), true);
	assert.equal(cg.is_current_period_group("2025"), false);
	assert.equal(cg.is_current_period_group("total"), false);
});

test("get_column_group_label uses Total for total group", () => {
	const cg = loadColumnGroupsModule();

	assert.equal(
		cg.get_column_group_label(
			{ period_group_label: "Total" },
			cg.TOTAL_GROUP_KEY
		),
		"Total"
	);
	assert.equal(
		cg.get_column_group_label(
			{ period_group_label: "Jan 2026" },
			"2026_01"
		),
		"Jan 2026"
	);
});
