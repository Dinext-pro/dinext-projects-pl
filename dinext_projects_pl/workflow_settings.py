"""Workflow defaults for the documents owned by this application."""


def email_profiles():
	return {
		"Budget": {"workflow": "Dinext Budget Approval", "approval_states": ('Pending Approval',)},
		"Purchase Invoice": {"workflow": "Purchase_Invoice_Workflow", "approval_states": ('На согласовании',)},
		"Sales Invoice": {"workflow": "Sales_Invoice_Workflow", "approval_states": ('На согласовании',)},
		"Expense Claim": {"workflow": "Expense_Claim_Workflow", "approval_states": ('Pending Approval',), "before_configure": _configure_rejection},
	}


def _configure_rejection(workflow):
	if not any(row.state == "Rejected" for row in workflow.states):
		workflow.append("states", {"state": "Rejected", "doc_status": "0", "is_optional_state": 1,
			"update_field": "status", "update_value": "Rejected", "allow_edit": "All"})
	if not any(row.state == "Rejected" and row.next_state == "Draft" for row in workflow.transitions):
		workflow.append("transitions", {"state": "Rejected", "action": "Edit", "next_state": "Draft",
			"allowed": "All", "allow_self_approval": 1, "send_email_to_creator": 1,
			"condition": "doc.owner == frappe.session.user", "custom_parallel_approval_policy": "Any"})


_REVIEW_STATES = {
	"На согласовании": "Pending Approval",
	"Согласовано": "Approved",
	"Отклонено": "Rejected",
}


def expense_label_rules():
	return {
		"states": {"Черновик": "Draft", **_REVIEW_STATES},
		"card_states": _REVIEW_STATES,
		"cards": (
			"Заявок EC на согласовании",
			"Заявок EC Согласовано",
			"Заявок EC Отклонено",
			"Заявок EC у меня на согласовании",
			"Заявок EC Согласованных мной",
		),
	}


def purchase_request_label_rules():
	return {"optional_states": ("Черновик",)}
