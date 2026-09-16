/**
 * Shared Forecast dropdown registry for P&L / risk / WE.
 * Aliases must stay one array; registrars mutate in place.
 */

export const RISK_FORECAST_FLAG = "__dinext_risk_reserve_forecast";
export const WE_FORECAST_FLAG = "__pwr_pl_forecast_from_we";

function getNs(dp) {
	if (dp) {
		return dp;
	}
	const root = typeof globalThis !== "undefined" ? globalThis : {};
	root.dinext_projects = root.dinext_projects || {};
	return root.dinext_projects;
}

/** Merge both aliases onto one array. Returns that array. */
export function syncForecastMenuAliases(dp) {
	const ns = getNs(dp);
	if (!Array.isArray(ns.project_pl_forecast_menu)) {
		ns.project_pl_forecast_menu = [];
	}
	if (!Array.isArray(ns.project_budget_forecast_menu)) {
		ns.project_budget_forecast_menu = [];
	}
	if (ns.project_budget_forecast_menu === ns.project_pl_forecast_menu) {
		return ns.project_budget_forecast_menu;
	}

	const seen = new Set();
	const merged = [];
	for (const item of ns.project_pl_forecast_menu.concat(ns.project_budget_forecast_menu)) {
		if (!item || seen.has(item)) {
			continue;
		}
		seen.add(item);
		merged.push(item);
	}
	ns.project_pl_forecast_menu = merged;
	ns.project_budget_forecast_menu = merged;
	return merged;
}

/** Remove items with `flag`, then push `items`. Same array reference. */
export function replaceForecastMenuItems(flag, items, dp) {
	const menu = syncForecastMenuAliases(dp);
	for (let i = menu.length - 1; i >= 0; i--) {
		if (menu[i] && menu[i][flag]) {
			menu.splice(i, 1);
		}
	}
	for (const item of items || []) {
		if (item) {
			menu.push(item);
		}
	}
	return menu;
}

export function isTmPaymentScheme(frm) {
	const scheme = frm?.doc?.custom_payment_scheme;
	if (!scheme) {
		return false;
	}
	if (scheme === "Время и затраты (T&M)") {
		return true;
	}
	return /T\s*&\s*M/i.test(String(scheme)) || /время\s+и\s+затраты/i.test(String(scheme));
}

export function isWeRevenueForecastItem(item) {
	if (!item?.[WE_FORECAST_FLAG]) {
		return false;
	}
	if (item.__pwr_pl_forecast_kind === "revenue") {
		return true;
	}
	if (item.__pwr_pl_forecast_kind === "cost") {
		return false;
	}
	const source = "Revenue forecast from work efforts";
	const label = item.label || "";
	const translate = typeof __ === "function" ? __ : (s) => s;
	return label === source || label === translate(source);
}

export function hasReserveRisk(frm) {
	return (frm?.doc?.custom_project_risks || []).some((r) => r && Number(r.contingency_reserve));
}

/** Visible Forecast menu items for this project. */
export function getForecastMenuItems(frm, dp) {
	const raw = syncForecastMenuAliases(dp);
	const isTm = isTmPaymentScheme(frm);
	const reserveOk = hasReserveRisk(frm);
	const seen = new Set();
	const out = [];
	for (const item of raw) {
		if (!item || typeof item.label !== "string" || typeof item.action !== "function") {
			continue;
		}
		if (item[RISK_FORECAST_FLAG] && !reserveOk) {
			continue;
		}
		if (isWeRevenueForecastItem(item) && !isTm) {
			continue;
		}
		const key = item[RISK_FORECAST_FLAG]
			? "__risk__"
			: item[WE_FORECAST_FLAG]
				? `__we__:${item.__pwr_pl_forecast_kind || item.label}`
				: item.label;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}
