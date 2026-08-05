# Copyright (c) 2025, Dinord and contributors
import frappe


def _report_debug(msg, filters=None):
	if frappe.conf.developer_mode or (filters or {}).get("_report_debug"):
		frappe.log(msg)
