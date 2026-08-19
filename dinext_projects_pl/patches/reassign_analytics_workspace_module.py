import frappe


TARGET_MODULE = "Dinext Projects Pl"

DOCUMENTS = (
	("Workspace", "Аналитика"),
	("Number Card", "Коммерческие проекты"),
)


def execute():
	for doctype, name in DOCUMENTS:
		if not frappe.db.exists(doctype, name):
			continue
		current = frappe.db.get_value(doctype, name, "module")
		if current == TARGET_MODULE:
			continue
		frappe.db.set_value(doctype, name, "module", TARGET_MODULE, update_modified=False)
