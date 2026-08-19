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
		for prefix in ("plan", "forecast", "own_fact", "fact", "actual"):
			row[f"{prefix}_{self.KEY}"] = float(amounts.get(prefix, 0))
		return row

	def test_row_has_value_uses_own_not_rolled_actual(self):
		empty = self._row(actual=100, fact=100)
		self.assertFalse(_row_has_value(empty, self.PERIODS))
		own_fact = self._row(own_fact=50, fact=50, actual=50)
		self.assertTrue(_row_has_value(own_fact, self.PERIODS))
		own_plan = self._row(plan=10)
		self.assertTrue(_row_has_value(own_plan, self.PERIODS))

	def test_filter_drops_empty_leaves_keeps_ancestors(self):
		leaf_empty = self._row(id="empty")
		leaf_plan = self._row(id="plan", plan=20)
		parent = self._row(id="parent", actual=20, fact=20, children=[leaf_empty, leaf_plan])
		kept = _filter_zero_value_rows([parent], self.PERIODS)
		self.assertEqual(len(kept), 1)
		self.assertEqual([c["id"] for c in kept[0]["children"]], ["plan"])

	def test_rollup_on_is_own_plus_descendants(self):
		child = self._row(id="child", own_fact=100, fact=100, actual=100)
		grandchild_rolled = self._row(id="mid", own_fact=40, fact=140, actual=140)
		parent = self._row(id="parent", own_fact=10, fact=10, actual=10)
		_rollup_child_fact(parent, [child, grandchild_rolled], self.PERIODS, "forecast_and_fact")
		self.assertEqual(parent[f"fact_{self.KEY}"], 250)
		self.assertEqual(parent[f"actual_{self.KEY}"], 250)
		self.assertEqual(parent[f"own_fact_{self.KEY}"], 10)
