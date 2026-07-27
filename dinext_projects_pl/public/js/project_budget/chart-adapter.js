/**
 * Chart data from frm.project_budget (same shape as legacy build_pl_chart_data).
 * Walk mirrors summary.py: plan / fact|forecast via own_fact, not rolled actual_*.
 */

function toFloat(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

function rowPeriodAmount(row, periodKey, valueKey) {
	const field = valueKey === "fact" ? `own_fact_${periodKey}` : `${valueKey}_${periodKey}`;
	const direct = toFloat(row?.[field]);
	// Merge tails are siblings under parent — parent walk includes them.
	if (direct) {
		return direct;
	}
	let total = 0;
	for (const child of row?.children || []) {
		total += rowPeriodAmount(child, periodKey, valueKey);
	}
	return total;
}

function calcPeriodIncomeExpense(rootRows, period) {
	const key = period.key || `${period.year}_${period.month}`;
	const actualKey = period.is_past ? "fact" : "forecast";

	let plan_income = 0;
	let plan_expenses = 0;
	let actual_income = 0;
	let actual_expenses = 0;

	for (const row of rootRows || []) {
		const plan = rowPeriodAmount(row, key, "plan");
		const actual = rowPeriodAmount(row, key, actualKey);
		const rtype = row.root_type || "";
		if (rtype === "Expense") {
			plan_expenses += plan;
			actual_expenses += actual;
		} else if (rtype === "Income") {
			plan_income += plan;
			actual_income += actual;
		}
	}

	return { plan_income, plan_expenses, actual_income, actual_expenses };
}

/**
 * @returns {object|null} chart payload or null if v2 grid not ready
 */
export function buildChartData(frm) {
	const periods = frm.project_budget?.periods;
	const rows = frm.project_budget?.rows;
	if (!periods?.length || !rows?.length) {
		return null;
	}

	const labels = periods.map(
		(p) =>
			p.label ||
			(p.quarter
				? `Q${p.quarter} ${p.year}`
				: p.month
					? `${p.year}-${String(p.month).padStart(2, "0")}`
					: String(p.year))
	);

	const plan_income = [];
	const actual_income = [];
	const plan_expenses = [];
	const actual_expenses = [];
	const profit_plan = [];
	const profit_actual = [];

	for (const period of periods) {
		const r = calcPeriodIncomeExpense(rows, period);
		plan_income.push(parseFloat(r.plan_income.toFixed(2)));
		actual_income.push(parseFloat(r.actual_income.toFixed(2)));
		// Legacy chart: expenses as negative bars.
		plan_expenses.push(parseFloat((-r.plan_expenses).toFixed(2)));
		actual_expenses.push(parseFloat((-r.actual_expenses).toFixed(2)));
		profit_plan.push(parseFloat((r.plan_income - r.plan_expenses).toFixed(2)));
		profit_actual.push(parseFloat((r.actual_income - r.actual_expenses).toFixed(2)));
	}

	const cumulative_profit_plan = [];
	const cumulative_profit_actual = [];
	const cumulative_income_plan = [];
	const cumulative_income_actual = [];
	const cumulative_expenses_plan = [];
	const cumulative_expenses_actual = [];
	let cumP = 0;
	let cumA = 0;
	let cumIncomePlan = 0;
	let cumIncomeActual = 0;
	let cumExpensesPlan = 0;
	let cumExpensesActual = 0;

	for (let i = 0; i < profit_plan.length; i++) {
		cumP += profit_plan[i];
		cumA += profit_actual[i];
		cumIncomePlan += plan_income[i];
		cumIncomeActual += actual_income[i];
		cumExpensesPlan += plan_expenses[i];
		cumExpensesActual += actual_expenses[i];
		cumulative_profit_plan.push(parseFloat(cumP.toFixed(2)));
		cumulative_profit_actual.push(parseFloat(cumA.toFixed(2)));
		cumulative_income_plan.push(parseFloat(cumIncomePlan.toFixed(2)));
		cumulative_income_actual.push(parseFloat(cumIncomeActual.toFixed(2)));
		cumulative_expenses_plan.push(parseFloat(cumExpensesPlan.toFixed(2)));
		cumulative_expenses_actual.push(parseFloat(cumExpensesActual.toFixed(2)));
	}

	return {
		labels,
		plan_income,
		actual_income,
		plan_expenses,
		actual_expenses,
		profit_plan,
		profit_actual,
		cumulative_profit_plan,
		cumulative_profit_actual,
		cumulative_income_plan,
		cumulative_income_actual,
		cumulative_expenses_plan,
		cumulative_expenses_actual,
		periods,
		source: "project_budget",
	};
}

export function refreshChart(frm) {
	if (typeof globalThis.render_pl_chart_impl === "function") {
		globalThis.render_pl_chart_impl(frm, false);
	} else if (typeof render_pl_chart === "function") {
		render_pl_chart(frm, false);
	}
}
