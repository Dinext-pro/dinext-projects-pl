# Copyright (c) 2025, Dinord and contributors
from frappe.utils import flt, getdate, today


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


def compute_period_deltas(data, filters):
	"""Compute delta_% columns from atomic plan/display values per period."""
	if not filters.get("show_plan") or not data:
		return data

	view_type = filters.get("view_type", "forecast_actual")
	current = getdate(today())
	current_year = current.year
	current_month = current.month

	for row in data:
		for key in list(row.keys()):
			if not key.startswith("plan_"):
				continue

			period_key = key[5:]
			plan = flt(row.get(key))
			actual = flt(row.get(f"actual_{period_key}", 0))
			forecast = flt(row.get(f"forecast_{period_key}", 0))

			try:
				year, month = period_key.split("_")
				year = int(year)
				month = int(month)
			except ValueError:
				continue

			is_past = year < current_year or (year == current_year and month < current_month)

			if view_type == "actual_only":
				display = actual
			elif view_type == "forecast_only":
				display = forecast
			elif is_past:
				display = actual
			else:
				display = forecast

			if plan:
				row[f"delta_{period_key}"] = flt((display - plan) / plan * 100, 1)
			else:
				row[f"delta_{period_key}"] = 0

	return data
