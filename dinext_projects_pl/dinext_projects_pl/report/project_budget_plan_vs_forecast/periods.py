# Copyright (c) 2025, Dinord and contributors
from frappe.utils import flt


def _period_sort_key(fieldname):
	prefix, _, period_key = fieldname.partition("_")
	if not period_key:
		return (prefix, 0, 0)

	parts = period_key.split("_")
	if len(parts) != 2:
		return (prefix, 0, 0)

	try:
		return (prefix, int(parts[0]), int(parts[1]))
	except ValueError:
		return (prefix, 0, 0)


def apply_accumulated_values(data, columns, filters):
	"""Convert period columns to running totals per row when accumulated_values is enabled."""
	if not filters.get("accumulated_values"):
		return data

	if not data:
		return data

	period_columns = []
	for column in columns:
		fieldname = column.get("fieldname")
		if fieldname and fieldname.startswith(("plan_", "forecast_", "actual_")):
			period_columns.append(fieldname)

	if not period_columns:
		return data

	columns_by_prefix = {}
	for fieldname in period_columns:
		prefix = fieldname.split("_", 1)[0]
		columns_by_prefix.setdefault(prefix, []).append(fieldname)

	for prefix_columns in columns_by_prefix.values():
		prefix_columns.sort(key=_period_sort_key)

	for row in data:
		for prefix_columns in columns_by_prefix.values():
			running_total = 0
			for fieldname in prefix_columns:
				running_total += flt(row.get(fieldname, 0))
				row[fieldname] = running_total

	return data
