# Copyright (c) 2026, Dinext and contributors
"""Project Risk reserve handling aligned with project P&L (project_pl_calc.js)."""

from frappe.utils import cint, flt

DATA_TYPE_WITH_RISK = "with_risk"
DATA_TYPE_WITH_TASK = "with_task"
DATA_TYPE_WITHOUT_TASK = "without_task"


def is_risk_row(row):
	"""True when the budget row carries a Project Risk dimension."""
	if not row:
		return False
	if row.get("data_type") == DATA_TYPE_WITH_RISK:
		return True
	return cint(row.get("is_risk")) == 1


def split_financial_and_risk_amounts(rows):
	"""Split raw loader rows into financial (report) vs risk reserve buckets."""
	financial = []
	risk = []
	for row in rows or []:
		if is_risk_row(row):
			risk.append(row)
		else:
			financial.append(row)
	return financial, risk


def sum_risk_amounts(risk_rows, period_key=None, *, value_key="forecast"):
	"""Sum plan/forecast on risk reserve rows (not rolled into CoA hierarchy)."""
	total = 0.0
	amount_field = "forecast" if value_key == "forecast" else "plan"
	for row in risk_rows or []:
		if period_key:
			year = int(row.get("pba_year", 0))
			month = int(row.get("pba_month", 0))
			if f"{year}_{month:02d}" != period_key:
				continue
		total += flt(row.get(amount_field, 0))
	return total
