from __future__ import annotations

import frappe
from frappe.model.document import Document

from dinext_common.workflow_approval.scenarios import service

EXPENSE_WORKFLOW = "Expense_Claim_Workflow"


def restore_draft_status(doc: Document, method: str | None = None) -> None:
	"""Clear the previous rejection after Frappe restores protected form fields."""
	if doc.docstatus != 0 or doc.approval_status != "Rejected":
		return
	if doc.workflow_state not in ("Draft", "Pending Approval"):
		return

	if service.is_ready():
		context = service.workflow_context(doc)
		if not context or context[0] != EXPENSE_WORKFLOW:
			return
		workflow = context[1]
	else:
		from frappe.model.workflow import get_workflow_name

		if get_workflow_name(doc.doctype) != EXPENSE_WORKFLOW:
			return
		workflow = frappe.get_cached_doc("Workflow", EXPENSE_WORKFLOW)

	state = next((row for row in workflow.states if row.state == doc.workflow_state), None)
	if state and state.update_field == "approval_status" and state.update_value == "Draft":
		doc.approval_status = state.update_value
