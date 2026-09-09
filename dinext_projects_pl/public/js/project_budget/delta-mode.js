export const DELTA_MODE_PCT = "pct";
export const DELTA_MODE_ABS = "abs";

export function normalizeDeltaMode(mode) {
	return mode === DELTA_MODE_ABS ? DELTA_MODE_ABS : DELTA_MODE_PCT;
}

function toFinite(value) {
	if (value == null || value === "") {
		return null;
	}
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Pct: stored `delta_*`. Abs: actual − plan. Both missing → null. */
export function resolveDeltaValue({ plan, actual, storedPct, mode }) {
	if (normalizeDeltaMode(mode) === DELTA_MODE_ABS) {
		const planN = toFinite(plan);
		const actualN = toFinite(actual);
		if (planN == null && actualN == null) {
			return null;
		}
		return (actualN ?? 0) - (planN ?? 0);
	}
	return toFinite(storedPct);
}
