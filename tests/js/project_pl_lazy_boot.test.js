const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function projectRefreshHarness({ warm = false } = {}) {
	const handlers = [];
	const bindings = [];
	const errors = [];
	let loads = 0;
	let finishBundle;
	const wrapper = {
		addClass() {
			return this;
		},
		empty() {
			return this;
		},
		appendTo() {
			return this;
		},
	};
	const binder = (frm, field, mount) => bindings.push({ frm, field, mount });
	const context = {
		console: { error: (...args) => errors.push(args.join(" ")) },
		sessionStorage: { getItem: () => null },
		$: () => wrapper,
		frappe: {
			router: { on() {} },
			provide(name) {
				name.split(".").reduce((scope, key) => (scope[key] ||= {}), context);
			},
			assets: { bundled_asset: (name) => name },
			require(assets, callback) {
				assert.deepEqual(Array.from(assets), ["project-budget.bundle.js"]);
				loads += 1;
				return new Promise((resolve) => {
					finishBundle = () => {
						context.project_workload_assignment = { bindLazyTabMount: binder };
						resolve();
						callback();
					};
				});
			},
			call() {
				throw new Error("Inactive financial tabs must not fetch data");
			},
			ui: { form: { on: (_doctype, events) => handlers.push(events) } },
		},
	};
	context.window = context;
	if (warm) context.project_workload_assignment = { bindLazyTabMount: binder };
	vm.createContext(context);
	// Same relative order as doctype_js; execute the actual refresh/loader chain.
	for (const file of [
		"project_budget_tab.js",
		"project_budget_metrics.js",
		"project_budget_dashboard.js",
	]) {
		const source = path.resolve(__dirname, "../../dinext_projects_pl/public/js", file);
		vm.runInContext(fs.readFileSync(source, "utf8"), context, { filename: source });
	}
	const frm = {
		doctype: "Project",
		docname: "PROJECT-1",
		doc: { name: "PROJECT-1" },
		is_new: () => false,
		get_field: () => ({ $wrapper: wrapper, df: { hidden: 0 } }),
	};
	return {
		bindings,
		errors,
		loads: () => loads,
		finishBundle: () => finishBundle(),
		// Frappe's ScriptManager awaits each handler's returned promise.
		async refresh() {
			for (const handler of handlers) await handler.refresh(frm);
		},
	};
}

test("cold Project refresh waits for its bundle before binding metrics and dashboard", async () => {
	const harness = projectRefreshHarness();
	const refresh = harness.refresh();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(harness.loads(), 1);
	assert.deepEqual(harness.errors, []);
	assert.deepEqual(harness.bindings, []);
	harness.finishBundle();
	await refresh;
	assert.deepEqual(harness.errors, []);
	assert.deepEqual(
		harness.bindings.map(({ field }) => field),
		["custom_planning", "custom_metrics", "custom_pl_summary"]
	);
	assert.ok(harness.bindings.every(({ mount }) => typeof mount === "function"));
});

test("warm Project refresh binds all financial tabs without fetching the bundle again", async () => {
	const harness = projectRefreshHarness({ warm: true });
	await harness.refresh();
	assert.equal(harness.loads(), 0);
	assert.deepEqual(harness.errors, []);
	assert.deepEqual(
		harness.bindings.map(({ field }) => field),
		["custom_planning", "custom_metrics", "custom_pl_summary"]
	);
});
