# ruff: noqa: RUF001 -- Russian card names and stored workflow states are intentional.
"""Align expense cards with their personal-work and approval sections."""

import json

import frappe


def execute():
	for name, state in {
		"Заявок EC на согласовании": "На согласовании",
		"Заявок EC Согласовано": "Согласовано",
		"Заявок EC Отклонено": "Отклонено",
	}.items():
		if not frappe.db.exists("Number Card", name):
			continue
		card = frappe.get_doc("Number Card", name)
		before = card.as_dict()
		card.filters_json = json.dumps(
			[["Expense Claim", "workflow_state", "=", state], ["Expense Claim", "docstatus", "!=", 2]],
			ensure_ascii=False,
		)
		card.dynamic_filters_json = json.dumps(
			[
				[
					"Expense Claim",
					"employee",
					"in",
					"(frappe.boot.dinext_expense_claim_employees?.length ? frappe.boot.dinext_expense_claim_employees : [''])",
				],
				[
					"Expense Claim",
					"name",
					"is",
					"(frappe.boot.dinext_expense_claim_employees?.length ? 'set' : 'not set')",
				],
			]
		)
		if card.as_dict() != before:
			card.save(ignore_permissions=True)
	for name, state in {
		"Заявок EC у меня на согласовании": "На согласовании",
		"Заявок EC Согласованных мной": "Согласовано",
	}.items():
		if not frappe.db.exists("Number Card", name):
			continue
		card = frappe.get_doc("Number Card", name)
		before = card.as_dict()
		card.type = "Custom"
		card.document_type = "Workflow Task"
		card.method = "dinext_common.workflow_approval.api.get_legacy_number_card_result"
		card.filters_json = json.dumps(
			{"doc": "Expense Claim", "state": state, "route": "expense-claim"}, ensure_ascii=False
		)
		card.dynamic_filters_json = "[]"
		card.show_percentage_stats = 0
		if card.as_dict() != before:
			card.save(ignore_permissions=True)
