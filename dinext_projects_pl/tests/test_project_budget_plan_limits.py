# Copyright (c) 2026, Dinext and Contributors
# See license.txt

from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.project_budget.plan_limits import (
	find_plan_envelope_error,
	rollup_display_plan,
	validate_plan_writes,
)


class TestProjectBudgetPlanLimits(FrappeTestCase):
	KEY = "2026_6"

	def _row(self, row_id, account, own_plan=0, plan=None, dimensions=None, children=None, **extra):
		plan_value = own_plan if plan is None else plan
		row = {
			"id": row_id,
			"account": account,
			"account_label": extra.get("account_label", account),
			"dimensions": dimensions or [],
			"children": children or [],
			f"own_plan_{self.KEY}": float(own_plan),
			f"plan_{self.KEY}": float(plan_value),
		}
		return row

	def test_validate_allows_parent_envelope_above_children(self):
		child = self._row("child", "Child Acc", own_plan=40, dimensions=[{"doc": "Task", "docname": "T-1"}])
		parent = self._row("parent", "Parent Acc", own_plan=100, children=[child])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "Parent Acc",
					"dimensions": [],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 100}],
				}
			],
		)
		self.assertIsNone(error)

	def test_validate_blocks_parent_below_children_sum(self):
		child = self._row("child", "Child Acc", own_plan=80, dimensions=[{"doc": "Task", "docname": "T-1"}])
		parent = self._row("parent", "Parent Acc", own_plan=0, children=[child])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "Parent Acc",
					"dimensions": [],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 50}],
				}
			],
		)
		self.assertIsNotNone(error)
		self.assertIn("80", error)

	def test_validate_allows_clearing_parent_envelope_to_zero(self):
		child = self._row("child", "Child Acc", own_plan=80, dimensions=[{"doc": "Task", "docname": "T-1"}])
		parent = self._row("parent", "Parent Acc", own_plan=100, children=[child])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "Parent Acc",
					"dimensions": [],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 0}],
				}
			],
		)
		self.assertIsNone(error)

	def test_validate_blocks_child_that_breaks_parent_envelope(self):
		sibling = self._row("sib", "Sib Acc", own_plan=20, dimensions=[{"doc": "Task", "docname": "T-2"}])
		child = self._row("child", "Child Acc", own_plan=40, dimensions=[{"doc": "Task", "docname": "T-1"}])
		parent = self._row("parent", "Parent Acc", own_plan=100, children=[child, sibling])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "Child Acc",
					"dimensions": [{"doc": "Task", "docname": "T-1"}],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 90}],
				}
			],
		)
		self.assertIsNotNone(error)

	def test_validate_allows_child_within_parent_remainder(self):
		sibling = self._row("sib", "Sib Acc", own_plan=20, dimensions=[{"doc": "Task", "docname": "T-2"}])
		child = self._row("child", "Child Acc", own_plan=40, dimensions=[{"doc": "Task", "docname": "T-1"}])
		parent = self._row("parent", "Parent Acc", own_plan=100, children=[child, sibling])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "Child Acc",
					"dimensions": [{"doc": "Task", "docname": "T-1"}],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 70}],
				}
			],
		)
		self.assertIsNone(error)

	def test_validate_batch_children_together_cannot_exceed_parent(self):
		child_a = self._row("a", "A Acc", own_plan=40, dimensions=[{"doc": "Task", "docname": "T-A"}])
		child_b = self._row("b", "B Acc", own_plan=40, dimensions=[{"doc": "Task", "docname": "T-B"}])
		parent = self._row("parent", "Parent Acc", own_plan=100, children=[child_a, child_b])
		error = validate_plan_writes(
			[parent],
			[
				{
					"account": "A Acc",
					"dimensions": [{"doc": "Task", "docname": "T-A"}],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 60}],
				},
				{
					"account": "B Acc",
					"dimensions": [{"doc": "Task", "docname": "T-B"}],
					"amounts": [{"year": 2026, "month": 6, "plan_value": 60}],
				},
			],
		)
		self.assertIsNotNone(error)

	def test_rollup_display_plan_then_envelope_ok_when_parent_aggregates(self):
		child = self._row("child", "Child Acc", own_plan=40)
		parent = self._row("parent", "Parent Acc", own_plan=0, children=[child])
		rollup_display_plan([parent], [self.KEY])
		self.assertEqual(parent[f"plan_{self.KEY}"], 40)
		self.assertIsNone(find_plan_envelope_error([parent], [self.KEY]))
