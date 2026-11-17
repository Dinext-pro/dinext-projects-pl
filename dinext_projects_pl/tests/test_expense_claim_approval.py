import json
from importlib import import_module
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import frappe

from dinext_common.workflow_approval.scenarios import service
from dinext_projects_pl import hooks


class TestExpenseClaimApproval(TestCase):
	def test_returned_claims_recover_their_draft_approval_status(self):
		fixture = Path(__file__).resolve().parents[1] / "fixtures" / "workflow.json"
		workflow = next(row for row in json.loads(fixture.read_text()) if row["name"] == "Expense_Claim_Workflow")
		workflow = frappe._dict(workflow, states=[frappe._dict(row) for row in workflow["states"]])
		for state in ("Draft", "Pending Approval"):
			with self.subTest(state=state):
				doc = frappe._dict(
					doctype="Expense Claim", docstatus=0, workflow_state=state, approval_status="Rejected",
				)
				with (
					patch.object(service, "is_ready", return_value=True),
					patch.object(
						service, "workflow_context",
						return_value=(workflow.name, workflow, workflow.workflow_state_field, state),
					),
				):
					handler = hooks.doc_events.get(doc.doctype, {}).get("validate")
					if handler:
						module, method = handler.rsplit(".", 1)
						getattr(import_module(module), method)(doc)

				self.assertEqual(doc.approval_status, "Draft")
