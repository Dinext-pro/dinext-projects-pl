"""Personal expense identity for standard Desk Number Card filters."""

import frappe


def extend_bootinfo(bootinfo):
	# This narrow identity lookup exposes only IDs linked to the current user;
	# expense queries still apply their ordinary document permissions.
	bootinfo.dinext_expense_claim_employees = frappe.get_all(
		"Employee", filters={"user_id": frappe.session.user}, pluck="name", order_by="name asc"
	)
