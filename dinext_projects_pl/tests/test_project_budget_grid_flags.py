# Copyright (c) 2026, Dinext and Contributors
# See license.txt

from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
	_filter_zero_value_rows,
	_rollup_child_fact,
	_row_has_value,
)


def _period(key, is_past=True):
	return {"key": key, "is_past": is_past}


class TestProjectBudgetGridFlags(FrappeTestCase):
	KEY = "2026_6"
	PERIODS = [_period("2026_6", True)]

	def _row(self, **amounts):
		row = {"id": amounts.pop("id", "r"), "children": amounts.pop("children", [])}
		if "risk" in amounts:
			row["risk"] = amounts.pop("risk")
		for prefix in ("plan", "forecast", "own_fact", "fact", "actual"):
			row[f"{prefix}_{self.KEY}"] = float(amounts.get(prefix, 0))
		row[f"own_plan_{self.KEY}"] = float(amounts.get("own_plan", amounts.get("plan", 0)))
		row[f"own_forecast_{self.KEY}"] = float(amounts.get("own_forecast", amounts.get("forecast", 0)))
		return row

	def test_row_has_value_uses_own_not_rolled_actual(self):
		empty = self._row(actual=100, fact=100)
		self.assertFalse(_row_has_value(empty, self.PERIODS))
		own_fact = self._row(own_fact=50, fact=50, actual=50)
		self.assertTrue(_row_has_value(own_fact, self.PERIODS))
		own_plan = self._row(plan=10)
		self.assertTrue(_row_has_value(own_plan, self.PERIODS))
		rolled_only = self._row(plan=70, own_plan=0)
		self.assertFalse(_row_has_value(rolled_only, self.PERIODS))

	def test_filter_drops_empty_leaves_keeps_ancestors(self):
		leaf_empty = self._row(id="empty")
		leaf_plan = self._row(id="plan", plan=20)
		parent = self._row(id="parent", actual=20, fact=20, children=[leaf_empty, leaf_plan])
		kept = _filter_zero_value_rows([parent], self.PERIODS)
		self.assertEqual(len(kept), 1)
		self.assertEqual([c["id"] for c in kept[0]["children"]], ["plan"])

	def test_filter_drops_empty_task_stubs(self):
		"""Empty Task / dimension rows hide with empty accounts when show_zero_rows is off."""
		task_stub = self._row(id="acct-task")
		task_stub["task"] = "TASK-1"
		parent = self._row(id="acct", children=[task_stub])
		kept = _filter_zero_value_rows([parent], self.PERIODS)
		self.assertEqual(kept, [])

	def test_filter_drops_empty_risk_leaves(self):
		risk_stub = self._row(id="acct-risk")
		risk_stub["risk"] = "RISK-1"
		parent = self._row(id="acct", children=[risk_stub])
		kept = _filter_zero_value_rows([parent], self.PERIODS)
		self.assertEqual(kept, [])

	def test_filter_keeps_valued_task_row(self):
		task_row = self._row(id="acct-task", plan=20)
		task_row["task"] = "TASK-1"
		parent = self._row(id="acct", children=[task_row])
		kept = _filter_zero_value_rows([parent], self.PERIODS)
		self.assertEqual(len(kept), 1)
		self.assertEqual(kept[0]["children"][0]["task"], "TASK-1")

	def test_rollup_on_is_own_plus_descendants(self):
		child = self._row(id="child", own_fact=100, fact=100, actual=100)
		grandchild_rolled = self._row(id="mid", own_fact=40, fact=140, actual=140)
		parent = self._row(id="parent", own_fact=10, fact=10, actual=10)
		_rollup_child_fact(parent, [child, grandchild_rolled], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"fact_{self.KEY}"], 250)
		self.assertEqual(parent[f"actual_{self.KEY}"], 250)
		self.assertEqual(parent[f"own_fact_{self.KEY}"], 10)
		self.assertEqual(parent[f"own_plan_{self.KEY}"], 0)

	def test_plan_rollup_sums_children_when_parent_has_no_own(self):
		child_a = self._row(id="a", plan=40)
		child_b = self._row(id="b", plan=30)
		parent = self._row(id="parent", plan=0)
		_rollup_child_fact(parent, [child_a, child_b], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 70)
		self.assertEqual(parent[f"own_plan_{self.KEY}"], 0)

	def test_plan_rollup_keeps_own_envelope(self):
		child = self._row(id="c", plan=40)
		parent = self._row(id="parent", plan=100)
		_rollup_child_fact(parent, [child], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 100)
		self.assertEqual(parent[f"own_plan_{self.KEY}"], 100)

	def test_plan_rollup_zero_own_is_absent(self):
		child = self._row(id="c", plan=40)
		parent = self._row(id="parent", plan=0, own_plan=0)
		_rollup_child_fact(parent, [child], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 40)

	def test_plan_rollup_uses_child_display_including_descendants(self):
		grandchild_display = self._row(id="mid", plan=140, own_plan=0)
		child = self._row(id="child", plan=0, own_plan=0)
		parent = self._row(id="parent", plan=0, own_plan=0)
		_rollup_child_fact(parent, [child, grandchild_display], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 140)

	def test_forecast_rollup_sums_children_when_parent_has_no_own(self):
		child_a = self._row(id="a", forecast=40)
		child_b = self._row(id="b", forecast=30)
		parent = self._row(id="parent", forecast=0)
		_rollup_child_fact(parent, [child_a, child_b], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"forecast_{self.KEY}"], 70)
		self.assertEqual(parent[f"own_forecast_{self.KEY}"], 0)

	def test_forecast_rollup_keeps_own(self):
		child = self._row(id="c", forecast=40)
		parent = self._row(id="parent", forecast=100)
		_rollup_child_fact(parent, [child], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"forecast_{self.KEY}"], 100)
		self.assertEqual(parent[f"own_forecast_{self.KEY}"], 100)

	def test_plan_and_forecast_rollup_includes_risk_children(self):
		task = self._row(id="task", plan=40, forecast=25)
		risk = self._row(id="risk", plan=80, forecast=90, risk="RISK-1")
		parent = self._row(id="parent", plan=0, forecast=0)
		_rollup_child_fact(parent, [task, risk], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 120)
		self.assertEqual(parent[f"forecast_{self.KEY}"], 115)

	def test_own_plan_forecast_still_ignore_risk_children(self):
		task = self._row(id="task", plan=40, forecast=25)
		risk = self._row(id="risk", plan=80, forecast=90, risk="RISK-1")
		parent = self._row(id="parent", plan=200, forecast=150)
		_rollup_child_fact(parent, [task, risk], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"plan_{self.KEY}"], 200)
		self.assertEqual(parent[f"forecast_{self.KEY}"], 150)
