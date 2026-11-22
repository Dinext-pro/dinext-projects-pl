import json
import unittest
from pathlib import Path
from unittest.mock import patch

import frappe


class TestAppBootstrap(unittest.TestCase):
	def test_cancelled_budgets_leave_approval_workflow_selection(self):
		from dinext_common.workflow_approval.scenarios import service

		fixtures = Path(__file__).resolve().parents[1] / "fixtures" / "workflow.json"
		workflow = next(
			frappe._dict(row) for row in json.loads(fixtures.read_text()) if row["name"] == "Dinext Budget Approval"
		)
		with patch.object(service, "_definitions", return_value=[workflow]):
			for state, docstatus, eligible in (
				(None, 0, True),
				("Draft", 0, True),
				("Pending Approval", 0, True),
				("Approved", 1, True),
				("Cancelled Draft", 0, False),
				("Cancelled Approved", 2, False),
			):
				with self.subTest(state=state):
					source = frappe._dict(doctype="Budget", workflow_state=state, docstatus=docstatus)
					self.assertIs(service.select_workflow(source), workflow if eligible else None)

	def test_hooks_register_budget_approval_contract(self):
		from dinext_projects_pl import hooks

		self.assertEqual(
			hooks.after_install,
			"dinext_projects_pl.install.after_install",
		)
		self.assertIn("dinext_projects_pl.liquidity.setup.after_migrate", hooks.after_sync)
		self.assertIn("dinext_projects_pl.install.sync_accounting_dimensions", hooks.after_migrate)
		self.assertIn("dinext_projects_pl.liquidity.setup.after_migrate", hooks.after_migrate)
		fixture_doctypes = {entry.get("doctype") for entry in hooks.fixtures if isinstance(entry, dict)}
		self.assertIn("Role", fixture_doctypes)
		self.assertIn("Workflow", fixture_doctypes)
		self.assertIn("Workflow State", fixture_doctypes)
		self.assertIn("Workflow Action Master", fixture_doctypes)
		self.assertIn("Custom Field", fixture_doctypes)
		workflow_types = _fixture_filter_values(hooks, "Workflow", "document_type")
		self.assertIn("Expense Claim", workflow_types)
		docperm_parents = _fixture_filter_values(hooks, "Custom DocPerm", "parent")
		self.assertIn("Expense Claim", docperm_parents)
		self.assertIn("Expense Claim Type", docperm_parents)
		self.assertEqual(
			hooks.override_doctype_class["Budget"],
			"dinext_projects_pl.dinext_projects_pl.overrides.budget.Budget",
		)
		self.assertEqual(
			hooks.doc_events["Budget"]["on_submit"],
			"dinext_projects_pl.dinext_projects_pl.budget_approval.service.on_budget_submit",
		)
		self.assertEqual(
			hooks.doc_events["Budget"]["on_cancel"],
			"dinext_projects_pl.dinext_projects_pl.budget_approval.service.on_budget_cancel",
		)

	def test_invoice_permissions_sync_after_install_and_migrate(self):
		from dinext_projects_pl import hooks

		path = "dinext_projects_pl.invoice_approval_permissions.sync_invoice_approval_permissions"
		self.assertIn(path, hooks.after_sync)
		self.assertIn(path, hooks.after_migrate)

	def test_patch_list_does_not_register_budget_workflow_bootstrap(self):
		from pathlib import Path

		patches_txt = Path(__file__).resolve().parents[1] / "patches.txt"
		content = patches_txt.read_text(encoding="utf-8")
		self.assertNotIn(
			"dinext_projects_pl.patches.v1_0.bootstrap_budget_approval_workflow",
			content,
		)

	def test_bootstrap_uses_dedicated_budget_approver_role(self):
		from dinext_projects_pl.dinext_projects_pl.budget_approval import bootstrap

		self.assertEqual(bootstrap.ROLE_BUDGET_SUBMITTER, "Dinext_Project_Manager")
		self.assertEqual(bootstrap.ROLE_BUDGET_APPROVER, "Dinext_Budget_Approver")


def _fixture_filter_values(hooks, doctype, fieldname):
	values = set()
	for entry in hooks.fixtures:
		if not isinstance(entry, dict) or entry.get("doctype") != doctype:
			continue
		for condition in entry.get("filters") or []:
			if (
				isinstance(condition, list | tuple)
				and len(condition) == 3
				and condition[0] == fieldname
				and condition[1] == "in"
			):
				values.update(condition[2])
	return values
