"""One aggregate index serves the lazy tree, chart, drill-down and export."""

import base64
import json
from collections import defaultdict
from dataclasses import asdict
from datetime import timedelta
from decimal import Decimal

from .model import METRICS, ZERO, Flow, periods

LEVELS = ("direction", "project", "party", "contract", "order", "invoice", "payment")
EMPTY_LABELS = {
	"project": "Without project",
	"party": "Without counterparty",
	"contract": "Without contract",
	"order": "Without order",
	"invoice": "Without invoice",
	"payment": "Without payment document",
}
ALL_METRICS = (*METRICS, "adjustment", "transfer")
BALANCE_METRICS = ("actual_opening", "actual_closing", "projected_opening", "projected_closing")


def wire(value):
	if isinstance(value, Decimal):
		return float(value)
	if isinstance(value, dict):
		return {k: wire(v) for k, v in value.items()}
	if isinstance(value, list | tuple):
		return [wire(v) for v in value]
	if hasattr(value, "isoformat"):
		return value.isoformat()
	return value


def node_key(path):
	return (
		base64.urlsafe_b64encode(json.dumps(path, ensure_ascii=False, separators=(",", ":")).encode())
		.decode()
		.rstrip("=")
	)


def path_of(flow, grouping):
	a = flow.analytic

	def link_value(link):
		return [link.doctype, link.name] if link else ""

	values = [
		flow.direction,
		a.project,
		[a.party_type, a.party] if a.party else "",
		a.contract,
		link_value(a.order),
		link_value(a.invoice),
		link_value(flow.payment),
	]
	if grouping == "party_project":
		values[1], values[2] = values[2], values[1]
	# An order's own plan stops at the order; an invoice's own forecast stops
	# at the invoice. Only actual payments or request/order stages add a payment node.
	depth = 5 if flow.metric == "plan" else 6 if flow.metric == "forecast" and not flow.payment else 7
	values = values[:depth]
	if grouping == "party_only":
		del values[1]
	return values


class Calendar:
	def __init__(self, filters, snapshot, flows, translate=lambda s: s):
		self.filters, self.snapshot, self.translate = filters, snapshot, translate
		self.periods = periods(filters)
		self.period_by_day = {}
		for period in self.periods:
			day = period.start
			while day <= period.end:
				self.period_by_day[day] = period.key
				day += timedelta(days=1)
		self.flows = [f for f in flows if not filters.direction or f.direction == filters.direction]
		self.visible = [f for f in self.flows if f.date is None or f.date in self.period_by_day]
		self._nodes = None
		self.children_by_parent = defaultdict(list)
		self.members = defaultdict(list)
		self.values = defaultdict(lambda: defaultdict(lambda: ZERO))
		levels = list(LEVELS)
		if filters.grouping == "party_project":
			levels[1], levels[2] = levels[2], levels[1]
		if filters.grouping == "party_only":
			levels.remove("project")
		self.levels = levels
		for i, flow in enumerate(self.visible):
			self.accumulate("root", i, flow, self.period_by_day.get(flow.date, "undated"))
		self.balances = self.build_balances()

	@property
	def has_undated(self):
		"""Describe the full authorized selection, independently of lazy tree rows."""
		metrics = set(self.filters.metrics)
		if {"actual", "forecast"}.issubset(metrics):
			metrics.remove("actual")  # The combined undated column displays forecast.
		return any(
			flow.date is None and flow.metric in metrics and (self.filters.show_zero or flow.amount != ZERO)
			for flow in self.visible
		)

	@property
	def nodes(self):
		self.ensure_tree()
		return self._nodes

	def ensure_tree(self):
		"""Build authorized analytical branches only when navigation needs them."""
		if self._nodes is not None:
			return
		self._nodes = {}
		edges = {}
		for i, flow in enumerate(self.visible):
			path = path_of(flow, self.filters.grouping)
			period = self.period_by_day.get(flow.date, "undated")
			parent = "root"
			for depth in range(1, len(path) + 1):
				value = path[depth - 1]
				edge = (parent, tuple(value) if isinstance(value, list) else value)
				key = edges.get(edge)
				if key is None:
					key = node_key(path[:depth])
					edges[edge] = key
				if key not in self._nodes:
					value = path[depth - 1]
					level = self.levels[depth - 1]
					label = (value[-1] if isinstance(value, list) else value) or self.translate(
						EMPTY_LABELS.get(level, "")
					)
					if level == "direction":
						label = self.translate("Receipts" if value == "in" else "Payments")
					self._nodes[key] = {
						"id": key,
						"label": label,
						"level": level,
						"depth": depth - 1,
						"parent": parent,
						"hasChildren": depth < len(path),
						"path": path[:depth],
					}
					self.children_by_parent[parent].append(key)
				self._nodes[key]["hasChildren"] |= depth < len(path)
				self.accumulate(key, i, flow, period)
				parent = key
		if not self.filters.show_zero:
			self._prune_zero_rows()
		for parent in self.children_by_parent:
			self.children_by_parent[parent].sort(key=lambda k: (self._nodes[k]["label"], k))

	def _prune_zero_rows(self):
		"""Filter navigation by displayed cells, retaining the full accounting index."""
		combined = {"actual", "forecast"}.issubset(self.filters.metrics)
		columns = {
			key + "__" + metric
			for key in ("undated", *(p.key for p in self.periods))
			for metric in self.filters.metrics
			if not combined or metric == "plan" or metric == self.period_metric(key)
		}
		keep = set()
		# Parents precede their children in the index. Preserve zero-valued parents
		# when a descendant has activity, including net-zero totals across periods.
		for key in reversed(self._nodes):
			if key in keep or any(self.values[key].get(column, ZERO) for column in columns):
				keep.add(key)
				keep.add(self._nodes[key]["parent"])
		for parent, children in self.children_by_parent.items():
			self.children_by_parent[parent] = [key for key in children if key in keep]
		for key, node in self._nodes.items():
			node["hasChildren"] = bool(self.children_by_parent.get(key))

	def accumulate(self, key, index, flow, period):
		self.members[key].append(index)
		self.values[key][period + "__" + flow.metric] += flow.amount
		if flow.overdue:
			self.values[key][period + "__" + flow.metric + "__overdue"] += flow.amount
		if flow.contract_overdue:
			self.values[key][period + "__" + flow.metric + "__contract_overdue"] += flow.amount
		if period != "undated":
			self.values[key]["total__" + flow.metric] += flow.amount

	@staticmethod
	def validate_node_key(key):
		if not isinstance(key, str) or not key or len(key) > 6000:
			raise ValueError("Unknown calendar node; refresh the report")

	def validate_node(self, key):
		self.validate_node_key(key)
		if key != "root" and key not in self.nodes:
			raise ValueError("Unknown calendar node; refresh the report")

	def children(self, key="root"):
		self.ensure_tree()
		self.validate_node(key)
		return [self.row(k) for k in self.children_by_parent.get(key, [])]

	def row(self, key):
		return wire({**self.nodes[key], **self.values[key]})

	def tree(self, depth=1):
		"""Return all branches through depth from this calculation, preserving lazy leaves."""

		def descend(key, remaining):
			rows = self.children(key)
			if remaining > 1:
				for row in rows:
					if row["hasChildren"]:
						row["children"] = descend(row["id"], remaining - 1)
			return rows

		return descend("root", depth)

	def all_rows(self):
		self.ensure_tree()

		def descend(key):
			for child in self.children_by_parent.get(key, []):
				yield self.row(child)
				yield from descend(child)

		return list(descend("root"))

	def period_metric(self, key):
		period = next((p for p in self.periods if p.key == key), None)
		return "actual" if period and period.end < self.snapshot.today else "forecast"

	def display_value(self, values, key, metric):
		if metric != "combined":
			return values.get(key + "__" + metric, 0)
		if key == "total":
			return sum((self.display_value(values, p.key, metric) for p in self.periods), 0)
		return values.get(key + "__" + self.period_metric(key), 0)

	def matches_metric(self, flow, metric):
		selected = self.period_metric(self.period_by_day.get(flow.date, "undated"))
		if metric == "combined":
			return flow.metric == selected
		if metric in ("combined_transfer", "combined_adjustment"):
			return selected == "actual" and flow.metric == metric.removeprefix("combined_")
		return flow.metric == metric

	@staticmethod
	def validate_cell_input(key, period, metric, start, page_length):
		"""Validate untrusted scalar arguments before loading any source documents."""
		Calendar.validate_node_key(key)
		if (
			not isinstance(period, str)
			or not period
			or len(period) > 200
			or not isinstance(metric, str)
			or metric
			not in (
				*ALL_METRICS,
				"combined",
				"combined_transfer",
				"combined_adjustment",
				*BALANCE_METRICS,
			)
		):
			raise ValueError("Invalid calendar cell")
		if isinstance(start, bool) or isinstance(page_length, bool):
			raise ValueError("Invalid pagination")
		try:
			if str(int(start)) != str(start) or str(int(page_length)) != str(page_length):
				raise ValueError
			start, page_length = int(start), int(page_length)
		except (TypeError, ValueError, OverflowError):
			raise ValueError("Invalid pagination") from None
		if start < 0 or not 1 <= page_length <= 200:
			raise ValueError("Invalid pagination")
		return start, page_length

	def details(self, key, period, metric, start=0, page_length=50):
		start, page_length = self.validate_cell_input(key, period, metric, start, page_length)
		self.validate_node("root" if key == "net" else key)
		if period not in {"undated", "total", *(p.key for p in self.periods)}:
			raise ValueError("Invalid calendar cell")
		if metric in BALANCE_METRICS:
			return self.balance_details(key, period, metric, start, page_length)

		rows = [
			self.visible[i]
			for i in self.members.get("root" if key == "net" else key, [])
			if self.matches_metric(self.visible[i], metric)
			and (
				(period == "total" and self.visible[i].date is not None)
				or self.period_by_day.get(self.visible[i].date, "undated") == period
			)
		]
		rows.sort(key=lambda f: (f.date is None, f.date, f.id))
		return wire(
			{
				"rows": [asdict(r) for r in rows[start : start + page_length]],
				"total": sum((r.signed if key == "net" else r.amount for r in rows), ZERO),
				"signed": key == "net",
				"count": len(rows),
				"start": start,
				"page_length": page_length,
				"as_of": self.snapshot.today,
			}
		)

	def balance_details(self, key, period_key, metric, start, page_length):
		if key != "root" or not self.balances:
			raise ValueError("Balances are not available for this selection")
		period = next((p for p in self.periods if p.key == period_key), None)
		balance = next((p for p in self.balances["periods"] if p["key"] == period_key), None)
		if not period or balance[metric] is None:
			raise ValueError("Balances are not available for this selection")
		cutoff = period.start - timedelta(days=1) if metric.endswith("opening") else period.end
		projected = metric.startswith("projected")
		anchor = self.snapshot.current_cash if projected else self.snapshot.opening
		lower = self.snapshot.today if projected else self.filters.from_date
		if projected and cutoff < self.snapshot.today:
			cutoff = self.snapshot.today - timedelta(days=1)
		rows = [
			f
			for f in self.flows
			if f.date
			and lower <= f.date <= cutoff
			and (f.metric == "forecast" if projected else f.metric in ("actual", "transfer", "adjustment"))
		]
		rows.sort(key=lambda f: (f.date, f.id))
		return wire(
			{
				"rows": [asdict(r) for r in rows[start : start + page_length]],
				"total": balance[metric],
				"anchor": anchor,
				"movement": sum((f.signed for f in rows), ZERO),
				"signed": True,
				"count": len(rows),
				"start": start,
				"page_length": page_length,
				"as_of": self.snapshot.today,
			}
		)

	def build_balances(self):
		s, f = self.snapshot, self.filters
		if not s.can_balance or f.analytical:
			return None
		actual = s.opening
		actual_by_day = {}
		day = f.from_date
		while day <= min(f.to_date, s.today):
			opening = actual
			actual += s.cash_daily.get(day, ZERO)
			actual_by_day[day] = (opening, actual)
			day += timedelta(days=1)
		forecast = defaultdict(lambda: ZERO)
		for flow in self.flows:
			if flow.metric == "forecast" and flow.date:
				forecast[flow.date] += flow.signed
		projected = s.current_cash
		projected_by_day = {}
		minimum, gap = None, None
		day = s.today
		if not f.accounts and s.complete:
			while day <= f.to_date:
				opening = projected
				projected += forecast.get(day, ZERO)
				projected_by_day[day] = (opening, projected)
				if day >= f.from_date:
					day_minimum = min(opening, projected)
					minimum = day_minimum if minimum is None else min(minimum, day_minimum)
					if day_minimum < 0 and gap is None:
						gap = day
				day += timedelta(days=1)
		rows = []
		for period in self.periods:
			act_start = actual_by_day.get(period.start)
			act_end = actual_by_day.get(min(period.end, s.today)) if period.start <= s.today else None
			proj_start = projected_by_day.get(max(period.start, s.today)) if period.end >= s.today else None
			proj_end = projected_by_day.get(period.end)
			rows.append(
				{
					"key": period.key,
					"actual_opening": act_start[0] if act_start else None,
					"actual_closing": act_end[1] if act_end else None,
					"projected_opening": proj_start[0] if proj_start else None,
					"projected_closing": proj_end[1] if proj_end else None,
				}
			)
		return wire(
			{
				"current_cash": s.current_cash,
				"minimum": minimum,
				"first_gap_date": gap,
				"periods": rows,
				"daily": [
					{"date": day, "opening": pair[0], "closing": pair[1]}
					for day, pair in projected_by_day.items()
				],
			}
		)

	def payload(self):
		self.ensure_tree()
		by_direction = {}
		for direction in ("in", "out"):
			key = node_key([direction])
			by_direction[direction] = wire(dict(self.values[key]))
		incoming, outgoing = by_direction["in"], by_direction["out"]
		net = {key: incoming.get(key, 0) - outgoing.get(key, 0) for key in set(incoming) | set(outgoing)}
		return wire(
			{
				"filters": asdict(self.filters),
				"as_of": self.snapshot.today,
				"currency": self.snapshot.currency,
				"precision": self.snapshot.precision,
				"periods": [asdict(p) for p in self.periods],
				"has_undated": self.has_undated,
				"rows": self.children(),
				"directions": by_direction,
				"net": net,
				"balances": self.balances,
				"complete": self.snapshot.complete,
				"warnings": [self.translate(s) for s in dict.fromkeys(self.snapshot.warnings)],
				"kpis": {
					"expected_receipts": incoming.get("total__forecast", 0),
					"expected_payments": outgoing.get("total__forecast", 0),
				},
				"account_filter_note": self.translate(
					"Cash accounts filter actual movements and actual balances only; plan and forecast remain company-wide"
				),
			}
		)
