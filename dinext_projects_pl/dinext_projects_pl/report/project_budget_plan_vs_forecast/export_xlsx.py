# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe import _
from frappe.utils import cint, flt

from .validate import validate_filters
from .totals import apply_accumulated_presentation


@frappe.whitelist()
def export_budget_report(filters=None):
	"""Export report with grouped period header row."""
	from .project_budget_plan_vs_forecast import execute

	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	filters = filters or {}
	validate_filters(filters)
	columns, data = execute(filters)

	if filters.get("accumulated_values"):
		data = apply_accumulated_presentation(data, columns, filters)

	xlsx_data, column_widths = build_grouped_xlsx_data(columns, data)

	from frappe.utils.xlsxutils import make_xlsx

	content = make_xlsx(xlsx_data, _("Project Budget Plan vs Forecast"), column_widths=column_widths).getvalue()
	filename = "project_budget_plan_vs_forecast.xlsx"

	frappe.local.response.filename = filename
	frappe.local.response.filecontent = content
	frappe.local.response.type = "download"


def build_grouped_xlsx_data(columns, data):
	visible_columns = [col for col in columns if not col.get("hidden")]

	header_group = []
	header_atomic = []
	column_widths = []

	for col in visible_columns:
		fieldname = col.get("fieldname")
		width = cint(col.get("width", 0)) / 10 or 12
		column_widths.append(width)
		label = col.get("label") or ""

		if fieldname == "account" or not col.get("period_group"):
			header_group.append(label)
			header_atomic.append("")
		else:
			header_group.append(col.get("period_group_label") or label)
			header_atomic.append(label)

	rows = [header_group, header_atomic]

	for row in data or []:
		if not isinstance(row, dict):
			continue
		if row.get("is_report_meta"):
			continue
		row_data = []
		for col in visible_columns:
			fieldname = col.get("fieldname")
			value = row.get(fieldname, "")
			if col.get("fieldtype") == "Currency":
				value = flt(value)
			elif value is None:
				value = ""
			row_data.append(value)
		rows.append(row_data)

	return rows, column_widths
