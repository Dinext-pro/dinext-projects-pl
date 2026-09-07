import unittest


class TestAppBootstrap(unittest.TestCase):
    def test_hooks_register_budget_approval_contract(self):
        from dinext_projects_pl import hooks

        self.assertEqual(
            hooks.after_install,
            "dinext_projects_pl.install.after_install",
        )
        self.assertEqual(
            hooks.after_migrate,
            "dinext_projects_pl.install.sync_accounting_dimensions",
        )
        fixture_doctypes = {
            entry.get("doctype")
            for entry in hooks.fixtures
            if isinstance(entry, dict)
        }
        self.assertIn("Role", fixture_doctypes)
        self.assertIn("Workflow", fixture_doctypes)
        self.assertIn("Workflow State", fixture_doctypes)
        self.assertIn("Workflow Action Master", fixture_doctypes)
        self.assertIn("Custom Field", fixture_doctypes)
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
