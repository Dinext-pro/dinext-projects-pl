import unittest

from dinext_projects_pl.dinext_projects_pl.project_budget.forecast_limits import forecast_envelope_error


def cell(account, amount=None, children=()):
    return {"id": account, "account": account, "own_forecast_2026_11": amount, "children": list(children)}


def change(account, amount):
    return {"account": account, "year": 2026, "month": 11, "value": amount}


class ForecastEnvelopeTests(unittest.TestCase):
    def test_sibling_writes_are_checked_together(self):
        root = cell("Group", 100, [cell("A", 30), cell("B", 40)])
        self.assertIsNotNone(forecast_envelope_error([root], [change("A", 60), change("B", 50)]))
        self.assertIsNone(forecast_envelope_error([root], [change("A", 60), change("B", 40)]))

    def test_explicit_zero_caps_descendants_but_clearing_releases_them(self):
        root = cell("Group", 0, [cell("A", 0)])
        self.assertIsNotNone(forecast_envelope_error([root], [change("A", 10)]))
        self.assertIsNone(forecast_envelope_error([root], [change("A", 10), change("Group", None)]))

    def test_decrease_can_repair_preexisting_overrun(self):
        root = cell("Group", 90, [cell("A", 95), cell("B", 30)])
        self.assertIsNone(forecast_envelope_error([root], [change("A", 92)]))
        self.assertIsNotNone(forecast_envelope_error([root], [change("A", 97)]))

    def test_parent_cannot_be_lowered_below_projected_children(self):
        root = cell("Group", 150, [cell("Mid", None, [cell("Leaf", 100)])])
        self.assertIsNotNone(forecast_envelope_error([root], [change("Group", 90)]))
        self.assertIsNone(forecast_envelope_error([root], [change("Group", 90), change("Leaf", 80)]))

    def test_rejects_dimension_not_offered_by_project_grid(self):
        from dinext_projects_pl.dinext_projects_pl.project_budget.forecast_limits import missing_forecast_row
        rows = [cell("Group", 100, [cell("A", 20)])]
        other_project_task = [{"doc": "Task", "docname": "elsewhere"}]
        self.assertEqual(missing_forecast_row(rows, [{**change("A", 300), "dimensions": other_project_task}]), "A")
        self.assertIsNone(missing_forecast_row(rows, [change("A", 40)]))
