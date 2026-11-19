from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, call, patch

import frappe

from dinext_projects_pl import hooks


class TestWorkflowInvoiceDependencies(TestCase):
	def test_invoice_projects_are_discovered_before_the_vote_locks_the_source(self):
		self.assertIn(
			"dinext_projects_pl.invoice_projects.lock_dependencies",
			getattr(hooks, "workflow_approval_lock_dependencies", []),
		)
		from dinext_projects_pl.invoice_projects import lock_dependencies

		header = Mock(return_value="P-1")
		with (
			patch.object(frappe, "get_all", return_value=["P-2", "P-2", None]) as items,
			patch.object(frappe, "db", SimpleNamespace(get_value=header)),
		):
			self.assertEqual(lock_dependencies("Sales Invoice", "SI-1"), [("Project", "P-1"), ("Project", "P-2")])
			self.assertEqual(lock_dependencies("Purchase Invoice", "PI-1"), [("Project", "P-2")])
			self.assertEqual(lock_dependencies("Project", "P-1"), [])

		header.assert_called_once_with("Sales Invoice", "SI-1", "project")
		self.assertEqual(
			items.call_args_list,
			[
				call("Sales Invoice Item", filters={"parent": "SI-1", "parenttype": "Sales Invoice"}, pluck="project"),
				call(
					"Purchase Invoice Item",
					filters={"parent": "PI-1", "parenttype": "Purchase Invoice"},
					pluck="project",
				),
			],
		)
