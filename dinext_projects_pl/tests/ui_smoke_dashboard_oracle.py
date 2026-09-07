# Copyright (c) 2026, Dinext and Contributors
"""Oracle helpers for UI dashboard smoke (bench execute)."""

import frappe
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.project_budget_plan_vs_forecast import (
	execute,
)
from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.totals import (
	apply_accumulated_presentation,
	get_root_financial_nodes,
)


def _dashboard_totals(data, columns, filters):
	"""Mirror summary.js build_budget_summary_totals (period vs accumulated)."""
	income_roots, expense_roots = get_root_financial_nodes(data)
	by_account = {row["account"]: row for row in data if row.get("account")}

	def _sum_roots(roots, fieldnames):
		total = 0
		for name in roots:
			row = by_account.get(name, {})
			for field in fieldnames:
				total += flt(row.get(field, 0))
		return total

	display_fields = []
	plan_fields = []
	for col in columns:
		fn = col.get("fieldname")
		if not fn:
			continue
		if fn.startswith("plan_") and col.get("period_group"):
			plan_fields.append(fn)
		if col.get("period_role") == "display" and col.get("period_group"):
			display_fields.append(fn)

	display_fields.sort()
	plan_fields.sort()

	if not display_fields:
		for col in columns:
			fn = col.get("fieldname") or ""
			if fn.startswith(("forecast_", "actual_")) and col.get("period_group"):
				display_fields.append(fn)
		display_fields.sort()

	accumulated = int(filters.get("accumulated_values") or 0)
	if accumulated and display_fields:
		income = _sum_roots(income_roots, [display_fields[-1]])
		expense = _sum_roots(expense_roots, [display_fields[-1]])
	else:
		income = _sum_roots(income_roots, display_fields)
		expense = _sum_roots(expense_roots, display_fields)

	return {
		"income": income,
		"expense": abs(expense),
		"profit": income - expense,
		"last_display_field": display_fields[-1] if display_fields else None,
	}


def run():
	frappe.set_user("Administrator")
	base = {
		"company": "Dinext",
		"from_year": 2026,
		"to_year": 2026,
		"from_month": 1,
		"to_month": 12,
		"view_type": "forecast_actual",
		"show_zero_columns": 1,
		"apply_cc_allocation": 1,
	}
	out = {}
	for mode, acc in (("period", 0), ("accumulated", 1)):
		filters = {**base, "accumulated_values": acc}
		columns, data = execute(filters)
		if acc:
			data = apply_accumulated_presentation(data, columns, filters)
		out[mode] = _dashboard_totals(data, columns, filters)

	period = out["period"]
	accumulated = out["accumulated"]
	for key in ("income", "expense", "profit"):
		if flt(period[key]) != flt(accumulated[key]):
			raise frappe.ValidationError(
				f"Dashboard {key} mismatch: period={period[key]} accumulated={accumulated[key]}"
			)

	print(out)
	return out
