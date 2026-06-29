# Copyright (c) 2025, Dinord and contributors
from frappe import _
from frappe.utils import cint, flt, getdate, today, formatdate


def get_period_granularity(filters):
	granularity = (filters.get("period_granularity") or "month").lower()
	if granularity in ("quarter", "quarterly"):
		return "quarter"
	if granularity in ("year", "yearly"):
		return "year"
	return "month"


def _is_period_past(year, month):
	current = getdate(today())
	return (year, month) < (current.year, current.month)


def _is_monthly_period_key(suffix):
	parts = (suffix or "").split("_")
	return len(parts) == 2 and parts[1].isdigit() and len(parts[1]) == 2


def get_report_periods(filters):
	"""Return ordered period definitions for the active granularity."""
	granularity = get_period_granularity(filters)
	from_year = cint(filters.get("from_year"))
	to_year = cint(filters.get("to_year"))
	from_month = cint(filters.get("from_month", 1))
	to_month = cint(filters.get("to_month", 12))
	current = getdate(today())

	if granularity == "month":
		periods = []
		for year in range(from_year, to_year + 1):
			start_month = 1 if year > from_year else from_month
			end_month = 12 if year < to_year else to_month
			for month in range(start_month, end_month + 1):
				key = "{0}_{1:02d}".format(year, month)
				month_name = formatdate(f"{year}-{month:02d}-01", "MMM")
				periods.append({
					"key": key,
					"label": _("{0} {1}").format(month_name, year),
					"year": year,
					"month": month,
					"is_past": _is_period_past(year, month),
					"monthly_keys": [key],
				})
		return periods

	range_start = from_year * 12 + from_month
	range_end = to_year * 12 + to_month

	if granularity == "quarter":
		periods = []
		for year in range(from_year, to_year + 1):
			for quarter in range(1, 5):
				q_start_month = (quarter - 1) * 3 + 1
				q_end_month = quarter * 3
				period_start = year * 12 + q_start_month
				period_end = year * 12 + q_end_month

				if period_end < range_start or period_start > range_end:
					continue

				monthly_keys = []
				for month in range(q_start_month, q_end_month + 1):
					period_month = year * 12 + month
					if range_start <= period_month <= range_end:
						monthly_keys.append("{0}_{1:02d}".format(year, month))

				if not monthly_keys:
					continue

				key = "{0}_Q{1}".format(year, quarter)
				periods.append({
					"key": key,
					"label": _("Q{0} {1}").format(quarter, year),
					"year": year,
					"quarter": quarter,
					"is_past": _is_period_past(year, q_end_month),
					"monthly_keys": monthly_keys,
				})
		return periods

	periods = []
	for year in range(from_year, to_year + 1):
		start_month = 1 if year > from_year else from_month
		end_month = 12 if year < to_year else to_month
		monthly_keys = [
			"{0}_{1:02d}".format(year, month)
			for month in range(start_month, end_month + 1)
		]
		if not monthly_keys:
			continue

		key = str(year)
		periods.append({
			"key": key,
			"label": str(year),
			"year": year,
			"is_past": year < current.year,
			"monthly_keys": monthly_keys,
		})
	return periods


def aggregate_data_by_granularity(data, filters):
	"""Roll monthly plan/forecast/actual columns up to quarter or year."""
	if get_period_granularity(filters) == "month" or not data:
		return data

	periods = get_report_periods(filters)
	prefixes = ("plan_", "forecast_", "actual_")

	for row in data:
		new_values = {}
		for period in periods:
			period_key = period["key"]
			for prefix in prefixes:
				total = 0
				has_source = False
				for monthly_key in period["monthly_keys"]:
					source_field = "{0}{1}".format(prefix, monthly_key)
					if source_field in row:
						has_source = True
					total += flt(row.get(source_field, 0))

				target_field = "{0}{1}".format(prefix, period_key)
				if has_source or total:
					new_values[target_field] = total

		for key in list(row.keys()):
			for prefix in prefixes:
				if not key.startswith(prefix):
					continue
				suffix = key[len(prefix):]
				if _is_monthly_period_key(suffix):
					row.pop(key, None)

		row.update(new_values)

	return data


def _period_sort_key(fieldname):
	prefix, _, period_key = fieldname.partition("_")
	if not period_key:
		return (prefix, 0, 0, 0)

	parts = period_key.split("_")
	if len(parts) == 1 and parts[0].isdigit():
		return (prefix, int(parts[0]), 0, 0)

	if len(parts) == 2:
		year_part, second = parts
		if second.startswith("Q") and second[1:].isdigit():
			return (prefix, int(year_part), int(second[1:]), 0)
		try:
			return (prefix, int(year_part), int(second), 0)
		except ValueError:
			pass

	return (prefix, 0, 0, 0)


def get_sorted_period_fieldnames(columns, prefix, require_period_group=False):
	"""Return period column fieldnames for a prefix in chronological order."""
	fieldnames = []
	for column in columns or []:
		fieldname = column.get("fieldname")
		if not fieldname or not fieldname.startswith(prefix):
			continue
		if require_period_group and not column.get("period_group"):
			continue
		fieldnames.append(fieldname)

	fieldnames.sort(key=_period_sort_key)
	return fieldnames


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
