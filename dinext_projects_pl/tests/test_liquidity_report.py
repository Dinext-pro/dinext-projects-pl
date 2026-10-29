"""The standard Script Report obeys the same display semantics as Desk/XLSX."""

import unittest
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from dinext_projects_pl.dinext_projects_pl.report.liquidity_payment_calendar import (
	liquidity_payment_calendar as report,
)
from dinext_projects_pl.liquidity.model import Analytic, Filters, Flow, Link, Snapshot
from dinext_projects_pl.liquidity.presentation import Calendar


class TestLiquidityReport(unittest.TestCase):
	def result(self, metrics=("actual", "forecast"), grain="day"):
		today = date(2026, 10, 29)
		filters = Filters(
			"Company", today - timedelta(days=1), today + timedelta(days=1), grain=grain, metrics=metrics
		)

		def flow(key, metric, amount, offset):
			day = today + timedelta(days=offset) if offset is not None else None
			return Flow(
				key,
				metric,
				"out",
				Decimal(amount),
				day,
				day,
				Link("Purchase Invoice", key),
				Analytic(),
				"USD",
				Decimal(amount),
			)

		flows = [
			flow("past", "actual", 20, -1),
			flow("today-paid", "actual", 30, 0),
			flow("today-due", "forecast", 40, 0),
			flow("tomorrow", "forecast", 50, 1),
			flow("undated", "forecast", 7, None),
			flow("order", "plan", 123, 0),
		]
		return Calendar(filters, Snapshot(today, "USD"), flows)

	def execute(self, metrics=("actual", "forecast"), grain="day"):
		with (
			patch.object(report, "calendar", return_value=self.result(metrics, grain)),
			patch.object(report, "_", lambda s: s),
		):
			return report.execute({"company": "Company"})

	def test_combined_current_day_excludes_actual_and_matches_visible_total(self):
		columns, rows, _message, chart, _summary, _skip = self.execute()
		self.assertEqual(columns[1]["fieldname"], "undated__combined")
		self.assertEqual(columns[1]["label"], "Without date / Forecast")
		self.assertEqual(columns[-1]["fieldname"], "total__combined")
		self.assertEqual(columns[-1]["label"], "Total / Cash movement")
		self.assertEqual(rows[0]["2026-10-28__combined"], 20)
		self.assertEqual(rows[0]["2026-10-29__combined"], 40)
		self.assertEqual(rows[0]["2026-10-30__combined"], 50)
		self.assertEqual(rows[0]["total__combined"], 110)
		self.assertEqual(rows[0]["undated__combined"], 7)
		self.assertEqual(chart["data"]["datasets"][1]["values"], [-20, -40, -50])
		self.assertTrue(columns[2]["label"].endswith(" / Actual"))
		self.assertTrue(columns[3]["label"].endswith(" / Forecast"))

	def test_single_metric_modes_do_not_include_the_other_cash_metric(self):
		for metric, expected, total in (("actual", [-20, -30, 0], 50), ("forecast", [0, -40, -50], 90)):
			with self.subTest(metric=metric):
				columns, rows, _message, chart, _summary, _skip = self.execute((metric,))
				self.assertTrue(all(column["fieldname"].endswith("__" + metric) for column in columns[1:]))
				self.assertEqual(chart["data"]["datasets"][1]["values"], expected)
				self.assertEqual(rows[0]["total__" + metric], total)

	def test_plan_precedes_cash_and_never_increases_cash_series(self):
		columns, rows, _message, chart, _summary, _skip = self.execute(("forecast", "plan", "actual"))
		self.assertEqual(
			[column["fieldname"] for column in columns[1:3]], ["undated__plan", "undated__combined"]
		)
		self.assertEqual(rows[0]["total__plan"], 123)
		self.assertEqual(rows[0]["total__combined"], 110)
		self.assertEqual(chart["data"]["datasets"][1]["values"], [0, -123, 0])
		self.assertEqual(chart["data"]["datasets"][3]["values"], [-20, -40, -50])

	def test_plan_only_has_no_cash_series(self):
		columns, _rows, _message, chart, _summary, _skip = self.execute(("plan",))
		self.assertTrue(all(column["fieldname"].endswith("__plan") for column in columns[1:]))
		self.assertEqual(len(chart["data"]["datasets"]), 2)
		self.assertTrue(all(series["name"].endswith(" / Plan") for series in chart["data"]["datasets"]))

	def test_current_week_and_month_use_only_forecast_for_the_entire_period(self):
		for grain in ("week", "month"):
			with self.subTest(grain=grain):
				columns, rows, _message, chart, _summary, _skip = self.execute(grain=grain)
				self.assertEqual(rows[0]["total__combined"], 90)
				self.assertTrue(all(column["label"].endswith(" / Forecast") for column in columns[1:]))
				self.assertEqual(chart["data"]["datasets"][1]["values"], [-90])
