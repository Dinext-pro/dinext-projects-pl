/**
 * Tree helpers on frm.project_budget for forecast limits, risk reserves, WE parent-adjust.
 * No Sticky aggregatedBudget.
 */

export function flattenTree(rows) {
	const result = [];
	for (const row of rows || []) {
		result.push(row);
		if (row.children?.length) {
			result.push(...flattenTree(row.children));
		}
	}
	return result;
}

export function periodKey(period) {
	if (!period) return "";
	if (period.key) return period.key;
	return `${period.year}_${period.month}`;
}

export function dimsKey(dimensions) {
	return (dimensions || [])
		.map((d) => `${d.doc}:${d.docname}`)
		.sort()
		.join("|");
}

export function dimsEqual(a, b) {
	return dimsKey(a) === dimsKey(b);
}

export function forecastOf(row, key) {
	return Number(row?.[`forecast_${key}`] ?? row?.[`actual_${key}`] ?? 0);
}

export function setForecast(row, key, value) {
	if (!row) return;
	row[`forecast_${key}`] = Number(value) || 0;
}

export function findParent(rows, childId, parent = null) {
	for (const row of rows || []) {
		if (row.id === childId) return parent;
		if (row.children?.length) {
			const found = findParent(row.children, childId, row);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

export function childForecastSum(row, key, excludeId = null) {
	let sum = 0;
	for (const child of row.children || []) {
		if (excludeId && child.id === excludeId) continue;
		const own = forecastOf(child, key);
		if (own) {
			sum += own;
		} else {
			sum += childForecastSum(child, key);
		}
	}
	return sum;
}

export function parentForecastLimit(rows, row, key) {
	let current = row;
	while (current) {
		const parent = findParent(rows, current.id);
		if (!parent) return null;
		const parentForecast = forecastOf(parent, key);
		if (parentForecast > 0) {
			const siblings = childForecastSum(parent, key, current.id);
			return {
				maxAllowed: parentForecast - siblings,
				parent,
				parentLabel: parent.account_label || parent.account,
			};
		}
		current = parent;
	}
	return null;
}

/** Display periods: prefer project_budget, fallback get_budget_display_periods. */
export function getDisplayPeriods(frm) {
	const fromV2 = frm?.project_budget?.periods;
	if (fromV2?.length) {
		return fromV2.map((p) => ({
			year: p.year,
			month: p.month,
			key: p.key || `${p.year}_${p.month}`,
			is_past: !!p.is_past,
		}));
	}
	if (typeof get_budget_display_periods === "function") {
		return (get_budget_display_periods(frm, "month") || []).map((p) => ({
			year: p.year,
			month: p.month,
			key: `${p.year}_${p.month}`,
			is_past: !!p.is_past,
		}));
	}
	return [];
}

export function accountAllowsTask(rows, account) {
	if (!account) return false;
	return flattenTree(rows).some((r) => r.account === account && r.task);
}

/**
 * Find leaf/bucket row: same account + dimensions match (ignore Project Risk on basis).
 */
export function findRowByAccountDims(rows, account, dimensions) {
	const want = dimsKey(
		(dimensions || []).filter((d) => d && d.doc !== "Project Risk")
	);
	const flat = flattenTree(rows);
	let best = null;
	for (const row of flat) {
		if (row.summary_kind || row.account !== account) continue;
		const rowDims = dimsKey(
			(row.dimensions || []).filter((d) => d && d.doc !== "Project Risk")
		);
		if (rowDims === want) {
			best = row;
			break;
		}
		// Prefer exact; else account-only (no task) when want empty
		if (!want && !row.task && !row.risk && !best) {
			best = row;
		}
	}
	return best;
}

/** Basis forecast map {"Y_M": amount} for percent reserves. */
export function getBasisForecastMap(rows, account, dimensions, periods) {
	const out = {};
	const row = findRowByAccountDims(rows, account, dimensions);
	if (!row || !periods?.length) return out;
	for (const p of periods) {
		const key = periodKey(p);
		out[key] = flt(forecastOf(row, key), 2);
	}
	return out;
}

function cloneTree(rows) {
	return JSON.parse(JSON.stringify(rows || []));
}

/**
 * Apply reserve/forecast updates onto cloned tree (add to forecast_*).
 * Creates a synthetic risk child under matching parent if missing.
 */
export function applyUpdatesToTree(rows, updates) {
	const root = cloneTree(rows);
	for (const item of updates || []) {
		const account = (item.account || "").trim();
		const dimensions = item.dimensions || [];
		const taskId = dimensions.find((d) => d?.doc === "Task")?.docname || "";
		const riskId =
			dimensions.find((d) => d?.doc === "Project Risk")?.docname || "";
		const periodAmountMap = item.period_amount_map || {};

		let row = findRowByAccountDims(root, account, dimensions);
		if (!row && riskId) {
			const parentDims = taskId
				? [{ doc: "Task", docname: taskId }]
				: [];
			const parent = findRowByAccountDims(root, account, parentDims);
			if (parent) {
				row = {
					id: `${parent.id}|risk|${riskId}`,
					account,
					account_label: parent.account_label,
					task: taskId || null,
					risk: riskId,
					dimensions: dimensions.slice(),
					children: [],
					has_children: false,
					expandable: false,
				};
				parent.children = parent.children || [];
				parent.children.push(row);
				parent.has_children = true;
				parent.expandable = true;
			}
		}
		if (!row) continue;

		for (const pk of Object.keys(periodAmountMap)) {
			const amount = flt(periodAmountMap[pk], 2);
			if (amount <= 0) continue;
			setForecast(row, pk, forecastOf(row, pk) + amount);
		}
	}
	return root;
}

/**
 * After updates (reserves / WE forecast), raise parent forecasts when hierarchy breaks.
 * Returns { parent_adjustments, adjusted_parents } for bulk_save_reserve_budgets.
 */
export function buildParentAdjustmentsFromUpdates(frm, updates) {
	const parent_adjustments = [];
	const adjusted_parents = [];
	const rows = frm?.project_budget?.rows;
	if (!rows?.length || !updates?.length) {
		return { parent_adjustments, adjusted_parents };
	}

	const simulated = applyUpdatesToTree(rows, updates);
	const periodKeys = new Set();
	for (const item of updates) {
		for (const pk of Object.keys(item.period_amount_map || {})) {
			periodKeys.add(pk);
		}
	}
	if (!periodKeys.size) {
		return { parent_adjustments, adjusted_parents };
	}

	const adjustmentMap = {};

	for (const item of updates) {
		const account = (item.account || "").trim();
		const dimensions = item.dimensions || [];
		let leaf = findRowByAccountDims(simulated, account, dimensions);
		if (!leaf) continue;

		for (const pk of periodKeys) {
			const reserveValue = flt(item.period_amount_map?.[pk], 2);
			if (reserveValue <= 0) continue;

			let current = leaf;
			while (current) {
				const limit = parentForecastLimit(simulated, current, pk);
				if (!limit?.parent) break;

				const parent = limit.parent;
				const parentForecast = forecastOf(parent, pk);
				const requiredValue = flt(
					parentForecast + reserveValue - limit.maxAllowed,
					2
				);

				if (parentForecast > 0 && parentForecast < requiredValue) {
					setForecast(parent, pk, requiredValue);
					const adjKey = `${parent.account}|${dimsKey(parent.dimensions || [])}`;
					if (!adjustmentMap[adjKey]) {
						adjustmentMap[adjKey] = {
							account: parent.account,
							dimensions: (parent.dimensions || []).slice(),
							period_amount_map: {},
						};
						adjusted_parents.push({
							account: parent.account,
							dimensions: (parent.dimensions || []).slice(),
						});
					}
					adjustmentMap[adjKey].period_amount_map[pk] = requiredValue;
				}

				if (parentForecast > 0 && parentForecast >= requiredValue) {
					break;
				}
				current = parent;
			}
		}
	}

	for (const key of Object.keys(adjustmentMap)) {
		parent_adjustments.push(adjustmentMap[key]);
	}
	return { parent_adjustments, adjusted_parents };
}

export function isBudgetReady(frm) {
	return Boolean(frm?.project_budget?.rows?.length || frm?.project_budget?.table);
}
