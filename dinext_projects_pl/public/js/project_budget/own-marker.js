/** Physical bucket (own_*). Forecast: null = empty, 0 = manual own. Plan: 0 = absent. */

export const OWN_CELL_CLASS = "project-budget-cell--own";

function ownRaw(row, metric, periodKey) {
	return row?.[`own_${metric}_${periodKey}`];
}

export function hasOwnPhysicalAmount(row, metric, periodKey) {
	if (!row || row.summary_kind || !periodKey) {
		return false;
	}
	const raw = ownRaw(row, metric, periodKey);
	if (raw == null || raw === "") {
		return false;
	}
	const n = Number(raw);
	if (!Number.isFinite(n)) {
		return false;
	}
	if (metric === "forecast") {
		return true;
	}
	return n > 0;
}

export function isOwnPlanCell(row, periodKey) {
	return hasOwnPhysicalAmount(row, "plan", periodKey);
}

/** Forecast column only while it shows forecast, not GL fact (`period.is_past`). */
export function isOwnForecastCell(row, period) {
	if (!period || period.is_past) {
		return false;
	}
	return hasOwnPhysicalAmount(row, "forecast", period.key);
}

export function ownValueTooltip(isOwn) {
	return isOwn ? "Manual value" : undefined;
}
