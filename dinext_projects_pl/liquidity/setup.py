"""Idempotent metadata installation through Document APIs; financial sources are untouched."""

import json

import frappe
from frappe import _

from .sources import FINANCE_ROLES, PROJECT_ROLES

REPORT = "Liquidity Payment Calendar"


def install_report(export=False):
	if not frappe.db.exists("Report", REPORT):
		roles = frappe.get_all(
			"Role", filters={"name": ["in", sorted(FINANCE_ROLES | PROJECT_ROLES)]}, pluck="name"
		)
		doc = frappe.get_doc(
			{
				"doctype": "Report",
				"report_name": REPORT,
				"ref_doctype": "Project",
				"report_type": "Script Report",
				"is_standard": "Yes",
				"module": "Dinext Projects Pl",
				"disabled": 0,
				"add_total_row": 0,
				"disable_prepared_report_automation": 1,
				"roles": [{"role": role} for role in roles],
			}
		)
		doc.insert()
	else:
		doc = frappe.get_doc("Report", REPORT)
	if export:
		from frappe.modules.export_file import export_to_files

		export_to_files(
			record_list=[["Report", REPORT]], record_module="Dinext Projects Pl", create_init=True
		)
	return {"name": doc.name, "is_standard": doc.is_standard}


def install_workspace_links(workspaces=("Аналитика", "Фин. контроль")):
	# Validate our only new document link. Existing standard workspaces can have
	# links to optional apps/cards; preserve those already-imported references.
	if not frappe.db.exists("Report", REPORT):
		frappe.throw(_("Install Liquidity Payment Calendar before adding workspace links"))
	for name in workspaces:
		if not frappe.db.exists("Workspace", name):
			continue
		doc = frappe.get_doc("Workspace", name)
		if any(row.link_to == REPORT for row in doc.links):
			continue
		doc.append("links", {"type": "Card Break", "label": "Liquidity"})
		doc.append(
			"links",
			{"type": "Link", "label": REPORT, "link_type": "Report", "link_to": REPORT, "is_query_report": 1},
		)
		content = json.loads(doc.content or "[]")
		content.append(
			{
				"id": "liquidity-payment-calendar-card",
				"type": "card",
				"data": {"card_name": "Liquidity", "col": 4},
			}
		)
		doc.content = json.dumps(content, ensure_ascii=False)
		# Preserve repository workspace edits and site customizations; migration modifies the DB only.
		old = frappe.conf.developer_mode
		try:
			frappe.conf.developer_mode = 0
			doc.flags.ignore_links = True
			doc.save()
		finally:
			frappe.conf.developer_mode = old


def after_migrate():
	install_report()
	install_workspace_links()
