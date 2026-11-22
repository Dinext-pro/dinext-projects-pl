"""Permissions used by ERPNext when approved invoices are loaded and submitted."""

import frappe
from frappe.permissions import setup_custom_perms


INVOICE_APPROVAL_PERMISSIONS = {
	("Sales_Invoice_Workflow", "Dinext_Projects_Admin"): {
		"Item": ("read", "select"),
	},
	("Purchase_Invoice_Workflow", "Dinext_Projects_Director"): {
		"Item": ("read", "select"),
		"Account": ("select",),
		"Supplier": ("select",),
		"Buying Settings": ("read",),
	},
}


def sync_invoice_approval_permissions() -> None:
	for (workflow, role), permissions in INVOICE_APPROVAL_PERMISSIONS.items():
		if not frappe.db.get_value("Workflow", workflow, "is_active") or not frappe.db.exists(
			"Workflow Transition", {"parent": workflow, "allowed": role}
		):
			continue
		for doctype, rights in permissions.items():
			_ensure_role_permission(doctype, role, rights)


def _ensure_role_permission(doctype, role, rights):
	selector = {"parent": doctype, "role": role, "permlevel": 0, "if_owner": 0}
	permission = frappe.db.get_value("Custom DocPerm", selector, ["name", *rights], as_dict=True)
	if permission and all(permission.get(right) for right in rights):
		return
	values = dict.fromkeys(rights, 1)
	if permission:
		frappe.db.set_value("Custom DocPerm", permission.name, values)
	else:
		setup_custom_perms(doctype)
		frappe.get_doc({
			"doctype": "Custom DocPerm", "parenttype": "DocType", "parentfield": "permissions",
			**selector, **values,
		}).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=doctype)
