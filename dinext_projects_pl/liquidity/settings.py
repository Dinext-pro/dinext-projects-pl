"""Validated, immutable calendar policy; financial data is never cached here."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from functools import cached_property
from types import MappingProxyType
from typing import Literal

import frappe
from frappe import _

SUPPORTED = (
	"Sales Order",
	"Purchase Order",
	"Sales Invoice",
	"Purchase Invoice",
	"Payment Request",
	"Payment Order",
	"Payment Entry",
)
SETTINGS = "Payment Calendar Settings"
MANAGERS = {"System Manager", "Accounts Manager"}
FIFO_VERSION = "gross-explicit-first-v1"


@dataclass(frozen=True)
class SourcePolicy:
	metric: Literal["plan", "forecast"]
	doctype: str
	enabled: bool
	priority: int
	docstatuses: tuple[int, ...]
	statuses: tuple[str, ...]
	date_field: str
	fallback: str

	def accepts(self, doc) -> bool:
		return (
			self.enabled
			and int(doc.get("docstatus", 1)) in self.docstatuses
			and (not self.statuses or (doc.get("status") or "") in self.statuses)
		)


@dataclass(frozen=True)
class Policy:
	sources: tuple[SourcePolicy, ...]
	links: tuple[tuple[str, str, str], ...]
	version: str

	@cached_property
	def _source_index(self):
		return MappingProxyType({(s.metric, s.doctype): s for s in self.sources})

	@cached_property
	def _link_index(self):
		return frozenset(self.links)

	def source(self, metric, doctype):
		return self._source_index.get((metric, doctype))

	def refines(self, metric, previous, refining):
		return (metric, previous, refining) in self._link_index

	def as_dict(self):
		return {
			"sources": [asdict(s) for s in self.sources],
			"links": list(self.links),
			"settings_version": self.version,
			"fifo_algorithm": FIFO_VERSION,
		}


def date_fields(doctype):
	return tuple(
		dict.fromkeys(
			[
				*(("payment_schedule",) if doctype in SUPPORTED[:4] else ()),
				*(
					f.fieldname
					for f in frappe.get_meta(doctype).fields
					if f.fieldtype in ("Date", "Datetime")
				),
				"creation",
				"modified",
			]
		)
	)


def status_options(doctype):
	field = frappe.get_meta(doctype).get_field("status")
	return (
		tuple(v.strip() for v in (field.options or "").splitlines() if v.strip())
		if field and field.fieldtype == "Select"
		else ()
	)


def compile_policy(doc) -> Policy:
	sources = []
	seen = set()
	for row in doc.get("sources") or []:
		metric = str(row.get("metric") or "").lower()
		dt = row.get("source_doctype")
		if metric not in ("plan", "forecast") or dt not in SUPPORTED or (metric, dt) in seen:
			raise ValueError("Invalid or duplicate calendar source")
		seen.add((metric, dt))
		state = row.get("document_state")
		if state not in ("Draft", "Submitted", "Both"):
			raise ValueError("Invalid calendar document state")
		states = tuple(sorted(set(str(row.get("statuses") or "").splitlines()) - {""}))
		if set(states) - set(status_options(dt)):
			raise ValueError("Invalid calendar business state")
		dates = date_fields(dt)
		date_field = row.get("date_field")
		fallback = row.get("fallback_date_field")
		if (
			date_field not in dates
			or fallback not in (*dates, "previous", "undated")
			or fallback == "payment_schedule"
		):
			raise ValueError("Invalid calendar date field")
		priority = row.get("priority")
		try:
			if isinstance(priority, bool) or str(int(priority)) != str(priority):
				raise ValueError
			priority = int(priority)
		except (ValueError, TypeError, OverflowError):
			raise ValueError("Invalid calendar priority") from None
		if row.get("enabled") not in (0, 1, False, True):
			raise ValueError("Invalid calendar source flag")
		sources.append(
			SourcePolicy(
				metric,
				dt,
				bool(row.get("enabled")),
				priority,
				(0, 1) if state == "Both" else (0,) if state == "Draft" else (1,),
				states,
				date_field,
				fallback,
			)
		)
	if not sources:
		raise ValueError("Payment Calendar Settings is empty; configure Sources and Links")
	by_key = {(s.metric, s.doctype): s for s in sources}
	links = []
	for row in doc.get("links") or []:
		if row.get("enabled") not in (0, 1, False, True):
			raise ValueError("Invalid calendar link flag")
		if not row.get("enabled"):
			continue
		key = (str(row.get("metric") or "").lower(), row.get("source_doctype"), row.get("target_doctype"))
		metric, start, end = key
		if (metric, start) not in by_key or (metric, end) not in by_key or key in links:
			raise ValueError("Invalid or duplicate calendar link")
		if by_key[(metric, start)].priority >= by_key[(metric, end)].priority:
			raise ValueError("Calendar links must follow increasing priorities without cycles")
		links.append(key)
	sources = tuple(sorted(sources, key=lambda s: (s.metric, s.doctype)))
	links = tuple(sorted(links))
	content = json.dumps({"sources": [asdict(s) for s in sources], "links": links}, sort_keys=True)
	return Policy(sources, links, hashlib.sha256(content.encode()).hexdigest()[:20])


def load_policy() -> Policy:
	# Trusted configuration read: report access/financial scope is checked independently.
	# No shared cache: rollback/commit and cross-process saves are authoritative immediately.
	try:
		return compile_policy(frappe.get_doc(SETTINGS))
	except ValueError as exc:
		frappe.throw(_(str(exc)))


def initial_profile():
	sources = []
	for metric in ("Plan", "Forecast"):
		for dt in SUPPORTED:
			index = (
				0
				if dt.endswith("Order") and dt != "Payment Order"
				else 1
				if dt.endswith("Invoice")
				else SUPPORTED.index(dt) - 2
			)
			sources.append(
				{
					"metric": metric,
					"source_doctype": dt,
					"enabled": int((metric == "Plan") == (dt in SUPPORTED[:2])),
					"priority": (index + 1) * 10,
					"document_state": "Draft" if dt == "Payment Entry" else "Submitted",
					"statuses": "\n".join(
						v for v in status_options(dt) if v not in ("Draft", "Cancelled", "Failed")
					)
					if dt == "Payment Request"
					else "",
					"date_field": "payment_schedule"
					if dt in SUPPORTED[:4]
					else "transaction_date"
					if dt == "Payment Request"
					else "posting_date",
					"fallback_date_field": "due_date"
					if dt in SUPPORTED[2:4]
					else "undated"
					if dt in SUPPORTED[:2]
					else "previous",
				}
			)
	links = [
		{
			"metric": a["metric"],
			"source_doctype": a["source_doctype"],
			"target_doctype": b["source_doctype"],
			"enabled": 1,
		}
		for a in sources
		for b in sources
		if a["metric"] == b["metric"] and a["priority"] < b["priority"]
	]
	return {"sources": sources, "links": links}


def install_settings():
	# Empty profiles cannot be saved; disabled source rows remain intentional state.
	doc = frappe.get_doc(SETTINGS)
	if doc.get("sources") or doc.get("links"):
		return
	doc.update(initial_profile())
	doc.save(ignore_permissions=True)
