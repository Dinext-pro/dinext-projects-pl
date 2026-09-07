/** Physical bucket (own_*) vs rolled parent display. 0 = absent. */

export const OWN_CELL_CLASS = "project-budget-cell--own";

export function hasOwnPhysicalAmount(row, metric, periodKey) {
	if (!row || row.summary_kind || !periodKey) {
		return false;
	}
	const n = Number(row[`own_${metric}_${periodKey}`]);
	return Number.isFinite(n) && n > 0;
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
