# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe.utils import flt


def signed_pl_amount(root_type, debit, credit):
	"""Net P&L actual from GL amounts by account root type."""
	d = flt(debit)
	c = flt(credit)
	if root_type == "Income":
		return round(c - d, 0)
	if root_type == "Expense":
		return round(d - c, 0)
	return round(d - c, 0)
