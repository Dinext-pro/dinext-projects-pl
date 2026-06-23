# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate, formatdate


PERIOD_CURRENCY_WIDTH = 92
TOTAL_CURRENCY_WIDTH = 132
TOTAL_FORECAST_WIDTH = 142


def _period_subcolumns(period_key, month_name, year, month, is_past_month, show_plan, view_type):
	"""Atomic sub-columns per period (plan / fact|forecast)."""
	columns = []
	year_month_label = _("{0} {1}").format(month_name, year)

	if show_plan:
		columns.append({
			"label": _("Plan"),
			"fieldname": "plan_{0}".format(period_key),
			"fieldtype": "Currency",
			"width": PERIOD_CURRENCY_WIDTH,
			"precision": 0,
			"period_group": period_key,
			"period_group_label": year_month_label,
			"period_role": "plan",
		})

	if view_type == "forecast_actual":
		if is_past_month:
			columns.append({
				"label": _("Fact"),
				"fieldname": "actual_{0}".format(period_key),
				"fieldtype": "Currency",
				"width": PERIOD_CURRENCY_WIDTH,
				"precision": 0,
				"period_group": period_key,
				"period_group_label": year_month_label,
				"period_role": "display",
			})
		else:
			columns.append({
				"label": _("Forecast"),
				"fieldname": "forecast_{0}".format(period_key),
				"fieldtype": "Currency",
				"width": PERIOD_CURRENCY_WIDTH,
				"precision": 0,
				"period_group": period_key,
				"period_group_label": year_month_label,
				"period_role": "display",
			})
	elif view_type == "forecast_only":
		columns.append({
			"label": _("Forecast"),
			"fieldname": "forecast_{0}".format(period_key),
			"fieldtype": "Currency",
			"width": PERIOD_CURRENCY_WIDTH,
			"precision": 0,
			"period_group": period_key,
			"period_group_label": year_month_label,
			"period_role": "display",
		})
	elif view_type == "actual_only":
		columns.append({
			"label": _("Fact"),
			"fieldname": "actual_{0}".format(period_key),
			"fieldtype": "Currency",
			"width": PERIOD_CURRENCY_WIDTH,
			"precision": 0,
			"period_group": period_key,
			"period_group_label": year_month_label,
			"period_role": "display",
		})

	return columns


def get_columns(filters, data):
	columns = [
		{
			"label": _("Account"),
			"fieldname": "account",
			"fieldtype": "Link",
			"options": "Account",
			"width": 300,
			"tree": True,
		}
	]

	from_year = cint(filters.get("from_year"))
	to_year = cint(filters.get("to_year"))
	show_plan = filters.get("show_plan")
	view_type = filters.get("view_type", "forecast_actual")

	current_date = getdate(today())
	current_year = current_date.year
	current_month = current_date.month

	for year in range(from_year, to_year + 1):
		start_month = 1 if year > from_year else cint(filters.get("from_month", 1))
		end_month = 12 if year < to_year else cint(filters.get("to_month", 12))

		for month in range(start_month, end_month + 1):
			month_name = formatdate(f"{year}-{month:02d}-01", "MMM")
			period_key = "{0}_{1:02d}".format(year, month)
			is_past_month = (year < current_year) or (year == current_year and month < current_month)

			columns.extend(
				_period_subcolumns(
					period_key, month_name, year, month, is_past_month, show_plan, view_type
				)
			)

	return columns


def add_total_columns(columns, filters):
	"""Добавляем итоговые колонки"""
	view_type = filters.get("view_type", "forecast_actual")
	show_plan = filters.get("show_plan")

	total_columns = []

	if show_plan:
		total_columns.append({
			"label": _("Total Plan"),
			"fieldname": "total_plan",
			"fieldtype": "Currency",
			"width": TOTAL_CURRENCY_WIDTH,
			"precision": 0,
		})

	if view_type == "forecast_actual":
		total_columns.append({
			"label": _("Total Forecast/Fact"),
			"fieldname": "total_exp_fct",
			"fieldtype": "Currency",
			"width": TOTAL_FORECAST_WIDTH,
			"precision": 0,
		})
	elif view_type == "forecast_only":
		total_columns.append({
			"label": _("Total Forecast"),
			"fieldname": "total_exp",
			"fieldtype": "Currency",
			"width": TOTAL_CURRENCY_WIDTH,
			"precision": 0,
		})
	elif view_type == "actual_only":
		total_columns.append({
			"label": _("Total Fact"),
			"fieldname": "total_fct",
			"fieldtype": "Currency",
			"width": TOTAL_CURRENCY_WIDTH,
			"precision": 0,
		})

	return columns + total_columns


def filter_zero_columns(columns, data):
	"""Удаляет периодные колонки, где все атомарные значения периода равны 0."""
	if not data or not columns:
		return columns

	period_fields = {}
	for col in columns:
		fieldname = col.get("fieldname")
		period_group = col.get("period_group")
		if period_group and fieldname:
			period_fields.setdefault(period_group, []).append(fieldname)

	period_has_values = {group: False for group in period_fields}

	for row in data:
		for group, fields in period_fields.items():
			if period_has_values[group]:
				continue
			for fieldname in fields:
				if flt(row.get(fieldname)) != 0:
					period_has_values[group] = True
					break

	filtered_columns = []
	for col in columns:
		fieldname = col.get("fieldname")
		period_group = col.get("period_group")

		if fieldname == "account" or not period_group:
			filtered_columns.append(col)
		elif period_has_values.get(period_group):
			filtered_columns.append(col)

	return filtered_columns
