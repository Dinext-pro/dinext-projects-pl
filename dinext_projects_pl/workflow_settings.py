"""Workflow defaults for the documents owned by this application."""


def email_profiles():
	profiles = {
		"Budget": {"workflow": "Dinext Budget Approval", "approval_states": ('Pending Approval',)},
		"Purchase Invoice": {"workflow": "Purchase_Invoice_Workflow", "approval_states": ('На согласовании',)},
		"Sales Invoice": {"workflow": "Sales_Invoice_Workflow", "approval_states": ('На согласовании',)},
		"Expense Claim": {"workflow": "Expense_Claim_Workflow", "approval_states": ('Pending Approval',), "before_configure": _configure_rejection},
	}
	rejection_states = ("Rejected", "Отклонено")
	for profile in profiles.values():
		profile["migration"] = {
			"workflow_fields": {
				"send_email_alert": 1,
				"custom_group_workflow_action_emails": 1,
				"custom_group_interval_unit": "Days",
				"custom_group_interval_value": 1,
				"custom_group_send_times": "08:00, 17:00",
				"custom_group_send_time": "08:00:00",
				"custom_group_email_template": "Dinext Workflow Digest",
				"custom_workflow_action_email_template": "Dinext Workflow Action",
				"custom_attach_document_pdf": 0,
			},
			"enabled_states": profile["approval_states"] + rejection_states,
			"state_overrides": {
				state: {
					"custom_group_workflow_action_emails": 0,
					"next_action_email_template": "Dinext Workflow Correction",
				}
				for state in rejection_states
			},
			"creator_notification_states": rejection_states,
			"suppress_open_tasks_in_states": rejection_states,
		}
	return profiles


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
	return {"states": {}, "optional_states": ("Черновик",)}
