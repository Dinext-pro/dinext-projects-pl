# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe import _
from frappe.utils import flt, cint

from .periods import get_report_periods


PERIOD_CURRENCY_WIDTH = 92
TOTAL_CURRENCY_WIDTH = 132
TOTAL_FORECAST_WIDTH = 142


def _period_subcolumns(period, show_plan, view_type):
	"""Atomic sub-columns per period (plan / fact|forecast)."""
	columns = []
	period_key = period["key"]
	period_label = period["label"]
	is_past = period.get("is_past", False)

	if show_plan:
		columns.append({
			"label": _("Plan"),
			"fieldname": "plan_{0}".format(period_key),
			"fieldtype": "Currency",
			"width": PERIOD_CURRENCY_WIDTH,
			"precision": 0,
			"period_group": period_key,
			"period_group_label": period_label,
			"period_role": "plan",
		})

	if view_type == "forecast_actual":
		if is_past:
			columns.append({
				"label": _("Fact"),
				"fieldname": "actual_{0}".format(period_key),
				"fieldtype": "Currency",
				"width": PERIOD_CURRENCY_WIDTH,
				"precision": 0,
				"period_group": period_key,
				"period_group_label": period_label,
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
				"period_group_label": period_label,
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
			"period_group_label": period_label,
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
			"period_group_label": period_label,
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

	show_plan = filters.get("show_plan")
	view_type = filters.get("view_type", "forecast_actual")

	for period in get_report_periods(filters):
		columns.extend(_period_subcolumns(period, show_plan, view_type))

	return columns


TOTAL_PERIOD_GROUP = "total"


def _total_subcolumn(fieldname, label, period_role, width):
	return {
		"label": label,
		"fieldname": fieldname,
		"fieldtype": "Currency",
		"width": width,
		"precision": 0,
		"period_group": TOTAL_PERIOD_GROUP,
		"period_group_label": _("Total"),
		"period_role": period_role,
	}


def add_total_columns(columns, filters):
	"""Добавляем итоговые колонки"""
	view_type = filters.get("view_type", "forecast_actual")
	show_plan = filters.get("show_plan")

	total_columns = []

	if show_plan:
		total_columns.append(_total_subcolumn(
			"total_plan",
			_("Total Plan"),
			"plan",
			TOTAL_CURRENCY_WIDTH,
		))

	if view_type == "forecast_actual":
		total_columns.append(_total_subcolumn(
			"total_exp_fct",
			_("Total Forecast/Fact"),
			"display",
			TOTAL_FORECAST_WIDTH,
		))
	elif view_type == "forecast_only":
		total_columns.append(_total_subcolumn(
			"total_exp",
			_("Total Forecast"),
			"forecast",
			TOTAL_CURRENCY_WIDTH,
		))
	elif view_type == "actual_only":
		total_columns.append(_total_subcolumn(
			"total_fct",
			_("Total Fact"),
			"display",
			TOTAL_CURRENCY_WIDTH,
		))

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
