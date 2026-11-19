"""Validate all edited forecast cells against explicit account/dimension envelopes."""

from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import dimension_fingerprint


def missing_forecast_row(rows, changes):
	"""Only coordinates offered by this project's grid may be edited."""
	offered = set()
	stack = list(rows)
	while stack:
		row = stack.pop()
		offered.add((row["account"], dimension_fingerprint(row.get("dimensions") or [])))
		stack.extend(row.get("children") or [])
	return next((change["account"] for change in changes if (
		change["account"], dimension_fingerprint(change.get("dimensions") or [])
	) not in offered), None)


def forecast_envelope_error(rows, changes):
	"""Return the first offending (account, children sum), respecting batched edits."""
	edits = {}
	for change in changes:
		key = f"{int(change['year'])}_{int(change['month'])}"
		identity = (change["account"], dimension_fingerprint(change.get("dimensions") or []))
		edits.setdefault(key, {})[identity] = change.get("value")

	def visit(row, period, writes):
		identity = (row.get("account"), dimension_fingerprint(row.get("dimensions") or []))
		before = row.get(f"own_forecast_{period}")
		after = writes.get(identity, before)
		old_children = new_children = 0.0
		for child in row.get("children") or []:
			old, new, error = visit(child, period, writes)
			if error:
				return 0, 0, error
			old_children += old
			new_children += new
		# An existing overrun can be reduced incrementally. A cleared envelope
		# rolls up the children. Explicit zero still caps future child growth.
		if after is not None and new_children > after + 1e-9:
			if (after > 0 and after != before) or new_children > old_children + 1e-9:
				return 0, 0, (row.get("account_label") or row["account"], new_children)
		return (old_children if before is None else before,
		        new_children if after is None else after, None)

	for period, writes in edits.items():
		for row in rows:
			_, _, error = visit(row, period, writes)
			if error:
				return error
	return None
