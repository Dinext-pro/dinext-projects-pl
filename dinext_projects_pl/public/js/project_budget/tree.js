/** Default = legacy setTreeDepth(1): expand roots only. */
export function getDefaultExpandedIds(rows) {
	return (rows || [])
		.filter((row) => row?.id != null && (row.children?.length || row.has_children))
		.map((row) => String(row.id));
}

export function syncExpandedIds(frm) {
	const table = frm.project_budget?.table;
	if (!table?.expandedIds) return;
	const ids = [...table.expandedIds];
	frm._project_budget_expanded_ids = ids;
	if (frm.project_budget) {
		frm.project_budget.expandedIds = ids;
	}
}

export function attachTreePersistence(frm, table) {
	if (!table || table._treePersistence) return;

	const wrap = (methodName, isAsync = false) => {
		const original = table[methodName]?.bind(table);
		if (!original) return;
		if (isAsync) {
			table[methodName] = async (...args) => {
				const result = await original(...args);
				syncExpandedIds(frm);
				return result;
			};
			return;
		}
		table[methodName] = (...args) => {
			const result = original(...args);
			syncExpandedIds(frm);
			return result;
		};
	};

	wrap("toggleRow");
	wrap("expandRow", true);
	wrap("collapseRow");
	table._treePersistence = true;
}

export function getExpandedIds(frm) {
	if (frm._project_budget_expanded_ids?.length) {
		return frm._project_budget_expanded_ids;
	}
	if (frm.project_budget?.expandedIds?.length) {
		return frm.project_budget.expandedIds;
	}
	return getDefaultExpandedIds(frm.project_budget?.rows || []);
}
