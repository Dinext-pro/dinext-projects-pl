/** Default = legacy setTreeDepth(1): expand roots only. */
export function getDefaultExpandedIds(rows) {
	return (rows || [])
		.filter((row) => row?.id != null && (row.children?.length || row.has_children))
		.map((row) => String(row.id));
}

export function syncExpandedIds(frm) {
	const table = frm.pl_v2?.table;
	if (!table?.expandedIds) return;
	const ids = [...table.expandedIds];
	frm._pl_v2_expanded_ids = ids;
	if (frm.pl_v2) {
		frm.pl_v2.expandedIds = ids;
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
	if (frm._pl_v2_expanded_ids?.length) {
		return frm._pl_v2_expanded_ids;
	}
	if (frm.pl_v2?.expandedIds?.length) {
		return frm.pl_v2.expandedIds;
	}
	return getDefaultExpandedIds(frm.pl_v2?.rows || []);
}
