import { GRID_API } from "./constants.js";
import { ensurePlDefaults } from "./controls.js";
import { initState } from "./state.js";

function toNum(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function resolveActual(forecast, fact, isPast, viewMode) {
	if (viewMode === "forecast_only") return forecast;
	if (viewMode === "fact_only") return fact;
	return isPast ? fact : forecast;
}

function calcDeltaPct(plan, actual) {
	if (!plan) return 0;
	return Math.round(((actual - plan) / plan) * 1000) / 10;
}

function applyRowTotals(row, periods) {
	let planTotal = 0;
	let actualTotal = 0;
	for (const period of periods || []) {
		planTotal += toNum(row[`plan_${period.key}`]);
		actualTotal += toNum(row[`actual_${period.key}`]);
	}
	row.plan_total = planTotal;
	row.actual_total = actualTotal;
	row.delta_total = calcDeltaPct(planTotal, actualTotal);
}

/** Report analog: parent fact = own + descendants.
 *  Plan/forecast = own if set, else sum of non-risk child display values.
 */
function applyFactRollup(row, periods, viewMode) {
	const children = row.children || [];
	for (const child of children) {
		applyFactRollup(child, periods, viewMode);
	}
	const financialChildren = children.filter((child) => !child.risk);
	for (const period of periods || []) {
		const key = period.key;
		let fact = toNum(row[`own_fact_${key}`]);
		for (const child of children) {
			fact += toNum(child[`fact_${key}`]);
		}
		const ownPlan = toNum(row[`own_plan_${key}`]);
		let plan = toNum(row[`plan_${key}`]);
		if (row[`own_plan_${key}`] != null) {
			if (ownPlan > 0) {
				plan = ownPlan;
			} else {
				plan = 0;
				for (const child of financialChildren) {
					plan += toNum(child[`plan_${key}`]);
				}
			}
			row[`plan_${key}`] = plan;
		}
		const ownForecast = toNum(row[`own_forecast_${key}`]);
		let forecast = toNum(row[`forecast_${key}`]);
		if (row[`own_forecast_${key}`] != null) {
			if (ownForecast > 0) {
				forecast = ownForecast;
			} else {
				forecast = 0;
				for (const child of financialChildren) {
					forecast += toNum(child[`forecast_${key}`]);
				}
			}
			row[`forecast_${key}`] = forecast;
		}
		const actual = resolveActual(forecast, fact, period.is_past, viewMode);
		row[`fact_${key}`] = fact;
		row[`actual_${key}`] = actual;
		row[`delta_${key}`] = calcDeltaPct(plan, actual);
	}
	applyRowTotals(row, periods);
}

/** Report applyAccumulatedValues: running totals along plan + displayed actual. */
function applyAccumulatedValues(row, periods) {
	for (const child of row.children || []) {
		applyAccumulatedValues(child, periods);
	}
	let runPlan = 0;
	let runForecast = 0;
	let runFact = 0;
	let runActual = 0;
	for (const period of periods || []) {
		const key = period.key;
		runPlan += toNum(row[`plan_${key}`]);
		runForecast += toNum(row[`forecast_${key}`]);
		runFact += toNum(row[`fact_${key}`]);
		runActual += toNum(row[`actual_${key}`]);
		row[`plan_${key}`] = runPlan;
		row[`forecast_${key}`] = runForecast;
		row[`fact_${key}`] = runFact;
		row[`actual_${key}`] = runActual;
		row[`delta_${key}`] = calcDeltaPct(runPlan, runActual);
	}
	const last = periods?.[periods.length - 1];
	if (last) {
		row.plan_total = toNum(row[`plan_${last.key}`]);
		row.actual_total = toNum(row[`actual_${last.key}`]);
		row.delta_total = calcDeltaPct(row.plan_total, row.actual_total);
	}
}

function rootPeriodTotals(rows, key) {
	let planIncome = 0;
	let planExpense = 0;
	let actualIncome = 0;
	let actualExpense = 0;
	for (const row of rows || []) {
		const plan = toNum(row[`plan_${key}`]);
		const actual = toNum(row[`actual_${key}`]);
		if (row.root_type === "Income") {
			planIncome += plan;
			actualIncome += actual;
		} else if (row.root_type === "Expense") {
			planExpense += plan;
			actualExpense += actual;
		}
	}
	return { planIncome, planExpense, actualIncome, actualExpense };
}

/** Report addProfitRow: summary from displayed Income/Expense roots. */
function buildSummaryFromRoots(rows, periods, accumulated) {
	const profit = {
		id: "pl-v2-profit",
		account: "pl-v2-profit",
		account_label: __("Gross Profit"),
		parent_account: null,
		dimensions: [],
		has_children: false,
		indent: 0,
		expandable: 0,
		summary_kind: "profit",
	};
	const profitability = {
		id: "pl-v2-profitability",
		account: "pl-v2-profitability",
		account_label: __("Profitability"),
		parent_account: null,
		dimensions: [],
		has_children: false,
		indent: 0,
		expandable: 0,
		summary_kind: "profitability",
	};

	let planIncomeTotal = 0;
	let planExpenseTotal = 0;
	let actualIncomeTotal = 0;
	let actualExpenseTotal = 0;
	const last = periods?.[periods.length - 1];

	for (const period of periods || []) {
		const key = period.key;
		const t = rootPeriodTotals(rows, key);
		if (accumulated) {
			if (period === last) {
				planIncomeTotal = t.planIncome;
				planExpenseTotal = t.planExpense;
				actualIncomeTotal = t.actualIncome;
				actualExpenseTotal = t.actualExpense;
			}
		} else {
			planIncomeTotal += t.planIncome;
			planExpenseTotal += t.planExpense;
			actualIncomeTotal += t.actualIncome;
			actualExpenseTotal += t.actualExpense;
		}

		const profitPlan = t.planIncome - t.planExpense;
		const profitActual = t.actualIncome - t.actualExpense;
		profit[`plan_${key}`] = profitPlan;
		profit[`actual_${key}`] = profitActual;
		profit[`forecast_${key}`] = period.is_past ? 0 : profitActual;
		profit[`fact_${key}`] = period.is_past ? profitActual : 0;
		profit[`delta_${key}`] = calcDeltaPct(profitPlan, profitActual);

		const profPlan = t.planIncome ? Math.round((profitPlan / t.planIncome) * 10) / 10 : null;
		const profActual = t.actualIncome
			? Math.round((profitActual / t.actualIncome) * 10) / 10
			: null;
		profitability[`plan_${key}`] = profPlan;
		profitability[`actual_${key}`] = profActual;
		profitability[`forecast_${key}`] = period.is_past ? null : profActual;
		profitability[`fact_${key}`] = period.is_past ? profActual : null;
		profitability[`delta_${key}`] =
			profPlan != null && profActual != null ? calcDeltaPct(profPlan, profActual) : null;
	}

	const profitPlanTotal = planIncomeTotal - planExpenseTotal;
	const profitActualTotal = actualIncomeTotal - actualExpenseTotal;
	profit.plan_total = profitPlanTotal;
	profit.actual_total = profitActualTotal;
	profit.delta_total = calcDeltaPct(profitPlanTotal, profitActualTotal);

	const profPlanTotal = planIncomeTotal
		? Math.round((profitPlanTotal / planIncomeTotal) * 10) / 10
		: null;
	const profActualTotal = actualIncomeTotal
		? Math.round((profitActualTotal / actualIncomeTotal) * 10) / 10
		: null;
	profitability.plan_total = profPlanTotal;
	profitability.actual_total = profActualTotal;
	profitability.delta_total =
		profPlanTotal != null && profActualTotal != null
			? calcDeltaPct(profPlanTotal, profActualTotal)
			: null;

	return [profit, profitability];
}

function rowHasOwnValue(row, periods) {
	for (const period of periods || []) {
		const key = period.key;
		if (
			toNum(row[`own_plan_${key}`]) ||
			toNum(row[`own_forecast_${key}`]) ||
			toNum(row[`own_fact_${key}`])
		) {
			return true;
		}
	}
	return false;
}

function filterZeroValueRows(rows, periods) {
	const kept = [];
	for (const row of rows || []) {
		const children = filterZeroValueRows(row.children || [], periods);
		if (children.length) {
			row.children = children;
			row.has_children = true;
			row.expandable = 1;
			kept.push(row);
		} else if (rowHasOwnValue(row, periods)) {
			delete row.children;
			row.has_children = false;
			row.expandable = 0;
			kept.push(row);
		}
	}
	return kept;
}

function applyGridResponse(frm, message) {
	const state = initState(frm);
	state.periods = message.periods || [];
	const rows = message.rows || [];
	const viewMode = message.view_mode || "forecast_and_fact";
	const accumulated = !!frm.bg_accumulated_values;
	for (const row of rows) {
		applyFactRollup(row, state.periods, viewMode);
		if (accumulated) {
			applyAccumulatedValues(row, state.periods);
		}
	}
	state.rows = frm.bg_show_zero_rows ? rows : filterZeroValueRows(rows, state.periods);
	state.summaryRows = buildSummaryFromRoots(state.rows, state.periods, accumulated);
	return message;
}

export async function loadGridData(frm) {
	ensurePlDefaults(frm);
	const period_type = frm._pl_period_type || "month";

	try {
		const message = await frappe.xcall(GRID_API, {
			project: frm.doc.name,
			period_type,
			view_options: frm.budget_view_options || __("Forecast and actual"),
			show_zero_rows: frm.bg_show_zero_rows ? 1 : 0,
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
