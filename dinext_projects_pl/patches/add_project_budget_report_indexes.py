import frappe


def execute():
	frappe.db.add_index("Project Budget Amount", ["parent", "pba_year", "pba_month"])
