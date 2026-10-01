import frappe


TARGET_MODULE = "Dinext Projects Pl"

DOCUMENTS = (
	("Client Script", "Expense_Claim_Auto_Approver"),
	("Server Script", "EC_Project_Portfolio_Check"),
	("Number Card", "Заявок EC на согласовании"),
	("Number Card", "Заявок EC Отклонено"),
	("Number Card", "Заявок EC Согласованных мной"),
	("Number Card", "Заявок EC Согласовано"),
	("Number Card", "Заявок EC у меня на согласовании"),
)


def execute():
	for doctype, name in DOCUMENTS:
		if not frappe.db.exists(doctype, name):
			continue
		current = frappe.db.get_value(doctype, name, "module")
		if current == TARGET_MODULE:
			continue
		frappe.db.set_value(doctype, name, "module", TARGET_MODULE, update_modified=False)
