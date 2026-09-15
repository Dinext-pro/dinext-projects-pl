/**
 * P&L navigation — same as HTML project_pl.js (976406e):
 * - account / task row → List Budget (project + dinext_budget_account)
 * - plan cell → Form approved Budget
 * - fact (readonly actual) → General Ledger (ISS-2025-01237)
 */

import { flattenTree } from "./budget-tree.js";
import { FIND_APPROVED_BUDGET_API } from "./constants.js";
import { isOwnForecastCell } from "./own-marker.js";

function pad2(value) {
	return String(value).padStart(2, "0");
}

function monthStart(year, month) {
	return `${year}-${pad2(month)}-01`;
}

function monthEnd(year, month) {
	const last = new Date(year, month, 0).getDate();
	return `${year}-${pad2(month)}-${pad2(last)}`;
}

function parseMonthlyKey(key) {
	const match = /^(\d{4})_(\d{1,2})$/.exec(key || "");
	if (!match) {
		return null;
	}
	return { year: Number(match[1]), month: Number(match[2]) };
}

function isPlaceholderAccount(account) {
	return !account || String(account).startsWith("pl-v2-");
}

export function parseActualField(field) {
	if (field === "actual_total") {
		return { kind: "total" };
	}
	const match = /^actual_(.+)$/.exec(field || "");
	if (!match) {
		return null;
	}
	return { kind: "period", key: match[1] };
}

export function parsePlanField(field) {
	if (field === "plan_total") {
		return { kind: "total" };
	}
	const match = /^plan_(.+)$/.exec(field || "");
	if (!match) {
		return null;
	}
	return { kind: "period", key: match[1] };
}

function resolvePeriodYearMonth(periods, periodKey) {
	const period = (periods || []).find((item) => item.key === periodKey);
	if (!period) {
		return null;
	}
	const firstKey = period.monthly_keys?.[0];
	const parsed = parseMonthlyKey(firstKey) || parseMonthlyKey(`${period.year}_${period.month}`);
	if (!parsed) {
		return null;
	}
	return parsed;
}

function openBudgetList(frm, row) {
	const desk = globalThis.frappe;
	if (!desk?.set_route || !frm?.doc?.name || isPlaceholderAccount(row?.account)) {
		return;
	}
	const options = {
		project: frm.doc.name,
		dinext_budget_account: row.account,
		budget_against: row.task ? "Task" : "Project",
	};
	if (row.task) {
		options.task = row.task;
	}
	desk.route_options = options;
	desk.set_route("List", "Budget");
}

async function openApprovedBudget(frm, row, periodKey) {
	if (row?.summary_kind || isPlaceholderAccount(row?.account) || !periodKey) {
		return;
	}
	const desk = globalThis.frappe;
	const translate = desk?.__ || globalThis.__ || ((text) => text);
	const ym = resolvePeriodYearMonth(frm.project_budget?.periods, periodKey);
	if (!ym || typeof desk?.xcall !== "function" || typeof desk?.set_route !== "function") {
		return;
	}
	const name = await desk.xcall(FIND_APPROVED_BUDGET_API, {
		project: frm.doc.name,
		account: row.account,
		year: ym.year,
		month: ym.month,
		dimensions: row.dimensions || [],
	});
	if (!name) {
		desk.show_alert?.(translate("No approved Budget found for the selected cell."), 5);
		return;
	}
	desk.set_route("Form", "Budget", name);
}

export function collectGlAccounts(rows) {
	const accounts = [];
	const seen = new Set();
	for (const row of flattenTree(rows || [])) {
		if (row?.summary_kind || isPlaceholderAccount(row?.account)) {
			continue;
		}
		if (seen.has(row.account)) {
			continue;
		}
		seen.add(row.account);
		accounts.push(row.account);
	}
	return accounts;
}

export function resolveGlDateRange(frm, field, periods) {
	const parsed = parseActualField(field);
	if (!parsed) {
		return null;
	}

	if (parsed.kind === "total") {
		return {
			from_date: frm?.doc?.expected_start_date || null,
			to_date: frm?.doc?.expected_end_date || null,
			require_past: false,
		};
	}

	const period = (periods || []).find((item) => item.key === parsed.key);
	if (!period) {
		return null;
	}

	const keys = period.monthly_keys?.length
		? period.monthly_keys
		: period.year && period.month
			? [`${period.year}_${period.month}`]
			: [];
	const months = keys.map(parseMonthlyKey).filter(Boolean);
	if (!months.length) {
		return null;
	}

	const first = months[0];
	const last = months[months.length - 1];
	return {
		from_date: monthStart(first.year, first.month),
		to_date: monthEnd(last.year, last.month),
		require_past: true,
		is_past: !!period.is_past,
	};
}

export function resolveGlAccountFilter(row, rows) {
	if (row?.summary_kind || isPlaceholderAccount(row?.account)) {
		return collectGlAccounts(rows);
	}
	return row.account;
}

export function buildGlRouteOptions(frm, row, field, periods) {
	const range = resolveGlDateRange(frm, field, periods);
	if (!range?.from_date || !range?.to_date) {
		return null;
	}
	if (range.require_past && !range.is_past) {
		return null;
	}

	const value = Number(row?.[field]);
	if (!Number.isFinite(value) || value === 0) {
		return null;
	}

	const account = resolveGlAccountFilter(row, frm?.project_budget?.rows);
	if (!account || (Array.isArray(account) && !account.length)) {
		return null;
	}

	const task = row?.task ? [row.task] : [];

	return {
		company: frm.doc.company,
		account: Array.isArray(account) ? account : [account],
		from_date: range.from_date,
		to_date: range.to_date,
		from_fiscal_year: null,
		to_fiscal_year: null,
		cost_center: [],
		task,
		project_role: [],
		project: [frm.doc.name || frm.docname],
	};
}

export async function onCellDoubleClicked(frm, params) {
	const field = params?.colDef?.field || params?.column?.getColDef?.()?.field || "";
	const row = params?.data;
	if (!frm?.doc || !row) {
		return;
	}

	if (field === "account_label" && !row.summary_kind) {
		params?.event?.preventDefault?.();
		params?.event?.stopPropagation?.();
		openBudgetList(frm, row);
		return;
	}

	const plan = parsePlanField(field);
	if (plan) {
		const planValue = Number(row[field]);
		if (plan.kind === "total" || !Number.isFinite(planValue) || planValue === 0) {
			return;
		}
		params?.event?.preventDefault?.();
		params?.event?.stopPropagation?.();
		await openApprovedBudget(frm, row, plan.key);
		return;
	}

	const options = buildGlRouteOptions(frm, row, field, frm.project_budget?.periods);
	if (!options) {
		return;
	}

	params?.event?.preventDefault?.();
	params?.event?.stopPropagation?.();
	const desk = globalThis.frappe;
	if (!desk?.set_route) {
		return;
	}
	desk.route_options = options;
	desk.set_route("query-report", "General Ledger");
}

/** AG 33+ CellEditingStartedEvent has no eGridCell. Number editor exposes agSetEditValue. */
function clearForecastEditor(params) {
	const instances = params?.api?.getCellEditorInstances?.() || [];
	for (const editor of instances) {
		if (typeof editor?.agSetEditValue === "function") {
			editor.agSetEditValue(null);
			return;
		}
		const input = editor.getGui?.()?.querySelector?.("input");
		if (input) {
			input.value = "";
			return;
		}
	}
	const fallback = params?.eGridCell?.querySelector?.("input");
	if (fallback) {
		fallback.value = "";
	}
}

/** Type-to-edit already put a digit in the editor — do not wipe it. */
export function startedByTypingDigit(params) {
	const ev = params?.event;
	const key = ev?.key ?? ev?.data ?? ev?.event?.key;
	return typeof key === "string" && /^\d$/.test(key);
}

/** Non-own forecast (empty 0 / rollup) → empty editor. Keep typed digit or own 0. */
export function onCellEditingStarted(frm, params) {
	const field = params?.colDef?.field || "";
	if (!field.startsWith("actual_")) {
		return;
	}
	const periodKey = field.slice("actual_".length);
	const period = (frm?.project_budget?.periods || []).find((item) => item.key === periodKey);
	if (!period || period.is_past) {
		return;
	}
	if (isOwnForecastCell(params.data, period)) {
		return;
	}
	if (startedByTypingDigit(params)) {
		return;
	}

	clearForecastEditor(params);
}
