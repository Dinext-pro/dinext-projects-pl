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

/** Server summary.py: round((profit / income) * 100, 1); null when no income. */
function calcProfitabilityPct(profit, income) {
	if (!income) return null;
	return Math.round((profit / income) * 1000) / 10;
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

/** Project table: parent fact = own + descendants.
 *  Plan/forecast = own if set, else sum of child display values (incl. risk).
 *  BVF report still keeps risk off CoA — do not copy this into the report.
 */
function applyFactRollup(row, periods, viewMode) {
	const children = row.children || [];
	for (const child of children) {
		applyFactRollup(child, periods, viewMode);
	}
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
				for (const child of children) {
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
				for (const child of children) {
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

function isRiskRow(row) {
	return !!(row && row.risk);
}

function isOwnTrack(row, key, track) {
	const own = row[`own_${track}_${key}`];
	return own != null && toNum(own) > 0;
}

function riskTrackAmount(row, key, track) {
	const own = row[`own_${track}_${key}`];
	if (own != null) return toNum(own);
	return toNum(row[`${track}_${key}`]);
}

function sumRiskDescendants(row, key, track) {
	let total = 0;
	for (const child of row.children || []) {
		if (isRiskRow(child)) {
			total += riskTrackAmount(child, key, track);
		} else {
			total += sumRiskDescendants(child, key, track);
		}
	}
	return total;
}

/** Risk cut off by an own ancestor — not in that ancestor's displayed track. */
function riskNotInDisplayed(row, key, track) {
	if (isRiskRow(row)) return 0;
	if (isOwnTrack(row, key, track)) {
		return sumRiskDescendants(row, key, track);
	}
	let total = 0;
	for (const child of row.children || []) {
		if (!isRiskRow(child)) {
			total += riskNotInDisplayed(child, key, track);
		}
	}
	return total;
}

function actualUsesForecast(period, viewMode) {
	if (viewMode === "forecast_only") return true;
	if (viewMode === "fact_only") return false;
	return !period.is_past;
}

/** Period-level extras from own_* (survives applyAccumulatedValues). */
function collectRiskExpenseExtras(rows, periods, viewMode) {
	const extras = {};
	for (const period of periods || []) {
		let plan = 0;
		let actual = 0;
		for (const row of rows || []) {
			if (row.root_type !== "Expense") continue;
			plan += riskNotInDisplayed(row, period.key, "plan");
			if (actualUsesForecast(period, viewMode)) {
				actual += riskNotInDisplayed(row, period.key, "forecast");
			}
		}
		extras[period.key] = { plan, actual };
	}
	return extras;
}

function accumulateRiskExtras(extras, periods) {
	let runPlan = 0;
	let runActual = 0;
	const out = {};
	for (const period of periods || []) {
		const extra = extras[period.key] || { plan: 0, actual: 0 };
		runPlan += extra.plan;
		runActual += extra.actual;
		out[period.key] = { plan: runPlan, actual: runActual };
	}
	return out;
}

/** Report addProfitRow: summary from displayed Income/Expense roots + risk not in display. */
function buildSummaryFromRoots(rows, periods, accumulated, viewMode) {
	const extras = collectRiskExpenseExtras(
		rows,
		periods,
		viewMode || "forecast_and_fact"
	);
	const adj = accumulated ? accumulateRiskExtras(extras, periods) : extras;
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
		const extra = adj[key] || { plan: 0, actual: 0 };
		const planExpense = t.planExpense + extra.plan;
		const actualExpense = t.actualExpense + extra.actual;
		if (accumulated) {
			if (period === last) {
				planIncomeTotal = t.planIncome;
				planExpenseTotal = planExpense;
				actualIncomeTotal = t.actualIncome;
				actualExpenseTotal = actualExpense;
			}
		} else {
			planIncomeTotal += t.planIncome;
			planExpenseTotal += planExpense;
			actualIncomeTotal += t.actualIncome;
			actualExpenseTotal += actualExpense;
		}

		const profitPlan = t.planIncome - planExpense;
		const profitActual = t.actualIncome - actualExpense;
		profit[`plan_${key}`] = profitPlan;
		profit[`actual_${key}`] = profitActual;
		profit[`forecast_${key}`] = period.is_past ? 0 : profitActual;
		profit[`fact_${key}`] = period.is_past ? profitActual : 0;
		profit[`delta_${key}`] = calcDeltaPct(profitPlan, profitActual);

		const profPlan = calcProfitabilityPct(profitPlan, t.planIncome);
		const profActual = calcProfitabilityPct(profitActual, t.actualIncome);
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

	const profPlanTotal = calcProfitabilityPct(profitPlanTotal, planIncomeTotal);
	const profActualTotal = calcProfitabilityPct(profitActualTotal, actualIncomeTotal);
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
	state.view_mode = viewMode;
	state.summaryRows = buildSummaryFromRoots(state.rows, state.periods, accumulated, viewMode);
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

export {
	applyAccumulatedValues,
	applyFactRollup,
	accumulateRiskExtras,
	buildSummaryFromRoots,
	calcProfitabilityPct,
	collectRiskExpenseExtras,
};
