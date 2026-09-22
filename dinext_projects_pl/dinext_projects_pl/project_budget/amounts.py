# Copyright (c) 2026, Dinext
"""Загрузка plan/forecast/fact по account × dimension buckets для Project Budget grid."""

from __future__ import annotations

import frappe
from frappe.query_builder import DocType
from frappe.query_builder.functions import Coalesce, Sum
from frappe.utils import add_days, cint, get_first_day, getdate

from dinext_projects_pl.models import BucketAmounts
from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import (
	dimension_fingerprint,
	normalize_dimensions,
)


PROJECT_BUDGET = "Project Budget"
GL_ENTRY = "GL Entry"


def _to_float(value: object) -> float:
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def can_read_doctype(doctype: str) -> bool:
	"""DocType read (roles). Same first gate as list_readable. No query conditions."""
	return bool(frappe.has_permission(doctype, "read"))


def list_readable(
	doctype: str,
	filters: dict | None = None,
	fields: list[str] | None = None,
) -> list:
	"""get_list names/rows (roles + permission_query_conditions). No doctype read → []."""
	if not can_read_doctype(doctype):
		return []
	kwargs: dict = {"filters": filters, "limit_page_length": 0}
	if fields:
		kwargs["fields"] = fields
	else:
		kwargs["pluck"] = "name"
	return frappe.get_list(doctype, **kwargs) or []


def list_readable_pb_names(project: str) -> list[str]:
	"""Project Budget names visible via get_list (roles + query conditions)."""
	if not project:
		return []
	return list(list_readable(PROJECT_BUDGET, filters={"pb_project": project}))


def list_readable_gle_names(
	project: str,
	company: str,
	start_date: str | None,
	end_date: str | None,
) -> list[str]:
	"""GL Entry names visible via get_list for project + posting_date bounds."""
	if not project or not start_date or not end_date:
		return []
	return list(
		list_readable(
			GL_ENTRY,
			filters={
				"project": project,
				"company": company,
				"is_cancelled": 0,
				"posting_date": ["between", [getdate(start_date), getdate(end_date)]],
			},
		)
	)


def signed_gl_pl_amount(root_type: str | None, debit: object, credit: object) -> float:
	"""Income: credit - debit; Expense (default): debit - credit."""
	d = _to_float(debit)
	c = _to_float(credit)
	if root_type == "Income":
		return c - d
	return d - c


def period_date_bounds(periods: list[dict]) -> tuple[str | None, str | None]:
	"""Bounds from first/last monthly_keys (or year/month) across display periods."""
	if not periods:
		return None, None

	def _months_from_period(period: dict) -> list[tuple[int, int]]:
		out: list[tuple[int, int]] = []
		for key in period.get("monthly_keys") or []:
			parts = str(key).split("_")
			if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
				out.append((int(parts[0]), int(parts[1])))
		if out:
			return out
		year = period.get("year")
		month = period.get("month")
		if year and month:
			return [(int(year), int(month))]
		return []

	all_months: list[tuple[int, int]] = []
	for period in periods:
		all_months.extend(_months_from_period(period))
	if not all_months:
		return None, None
	all_months.sort()
	y0, m0 = all_months[0]
	y1, m1 = all_months[-1]
	start = f"{y0}-{m0:02d}-01"
	if m1 == 12:
		end = f"{y1}-12-31"
	else:
		next_first = get_first_day(f"{y1}-{m1 + 1:02d}-01")
		end = str(add_days(next_first, -1))
	return start, end


def _ensure_bucket(
	store: dict[str, dict[str, BucketAmounts]],
	account: str,
	dimensions: list[dict[str, str]],
	pb_docname: str | None = None,
) -> BucketAmounts:
	dims = normalize_dimensions(dimensions)
	key = dimension_fingerprint(dims)
	account_buckets = store.setdefault(account, {})
	if key not in account_buckets:
		account_buckets[key] = {
			"dimensions": dims,
			"pb_docname": pb_docname,
		}
	elif pb_docname and not account_buckets[key].get("pb_docname"):
		account_buckets[key]["pb_docname"] = pb_docname
	return account_buckets[key]


def _load_pb_dimensions_by_parent(pb_names: list[str]) -> dict[str, list[dict[str, str]]]:
	"""parent PB name -> normalized dimensions list."""
	if not pb_names:
		return {}
	pbd = DocType("Project Budget Dimension")
	rows = (
		frappe.qb.from_(pbd)
		.select(pbd.parent, pbd.doc, pbd.docname)
		.where(pbd.parent.isin(pb_names))
		.run(as_dict=True)
	)
	out: dict[str, list[dict[str, str]]] = {}
	for row in rows:
		if not row.doc or not row.docname:
			continue
		out.setdefault(row.parent, []).append({"doc": row.doc, "docname": row.docname})
	for parent, dims in out.items():
		out[parent] = normalize_dimensions(dims)
	return out


def load_budget_buckets(project: str) -> dict[str, dict[str, BucketAmounts]]:
	"""account -> dim_key -> bucket with plan_/forecast_ fields (SQL, no N+1 get_doc).

	Only Project Budget the user can get_list. No PB read → empty buckets, no throw.
	"""
	pb_rows = list_readable(
		PROJECT_BUDGET,
		filters={"pb_project": project},
		fields=["name", "pb_account"],
	)
	if not pb_rows:
		return {}

	pba = DocType("Project Budget Amount")

	pb_account = {r.name: r.pb_account for r in pb_rows if r.pb_account}
	pb_names = list(pb_account.keys())
	dims_by_pb = _load_pb_dimensions_by_parent(pb_names)
	has_expected_col = frappe.db.has_column("Project Budget Amount", "pba_has_expected")

	select_fields = [
		pba.parent,
		pba.pba_year,
		pba.pba_month,
		Coalesce(pba.pba_plan, 0).as_("plan"),
		Coalesce(pba.pba_expected, 0).as_("forecast"),
	]
	if has_expected_col:
		select_fields.append(pba.pba_has_expected.as_("has_expected"))

	amount_rows = (
		frappe.qb.from_(pba)
		.select(*select_fields)
		.where(pba.parent.isin(pb_names))
		.run(as_dict=True)
	)

	store: dict[str, dict[str, BucketAmounts]] = {}
	for row in amount_rows:
		account = pb_account.get(row.parent)
		if not account:
			continue
		dims = dims_by_pb.get(row.parent) or []
		bucket = _ensure_bucket(store, account, dims, pb_docname=row.parent)
		period_key = f"{int(row.pba_year)}_{int(row.pba_month)}"
		bucket[f"plan_{period_key}"] = _to_float(bucket.get(f"plan_{period_key}")) + _to_float(
			row.plan
		)
		# Flag or non-zero expected = explicit own. Bare 0 without flag = empty.
		if (has_expected_col and cint(row.get("has_expected"))) or _to_float(
			row.forecast
		) != 0:
			bucket[f"forecast_{period_key}"] = _to_float(
				bucket.get(f"forecast_{period_key}")
			) + _to_float(row.forecast)

	# PB docs without amount lines still create empty buckets for dimension structure
	for name, account in pb_account.items():
		dims = dims_by_pb.get(name) or []
		_ensure_bucket(store, account, dims, pb_docname=name)

	return store


def load_gl_fact_buckets(
	project: str,
	company: str,
	start_date: str | None,
	end_date: str | None,
	account_root_types: dict[str, str],
) -> dict[str, dict[str, BucketAmounts]]:
	"""account -> dim_key -> bucket with fact_ fields (Task dimension when set).

	Only GL Entry the user can get_list (role + Custom Query). No GL read → empty facts.
	"""
	store: dict[str, dict[str, BucketAmounts]] = {}
	if not start_date or not end_date:
		return store

	gle_filters = {
		"project": project,
		"company": company,
		"is_cancelled": 0,
		"posting_date": ["between", [getdate(start_date), getdate(end_date)]],
	}
	fields = ["account", "posting_date", "debit", "credit"]
	has_task = frappe.db.has_column(GL_ENTRY, "task")
	if has_task:
		fields.append("task")

	rows = list_readable(GL_ENTRY, filters=gle_filters, fields=fields)

	for row in rows:
		account = row.account
		if not account:
			continue
		dims: list[dict[str, str]] = []
		task = row.get("task") if has_task else None
		if task:
			dims = [{"doc": "Task", "docname": task}]
		bucket = _ensure_bucket(store, account, dims)
		dt = getdate(row.posting_date)
		field = f"fact_{dt.year}_{dt.month}"
		amount = signed_gl_pl_amount(account_root_types.get(account), row.debit, row.credit)
		bucket[field] = _to_float(bucket.get(field)) + amount

	return store


def merge_bucket_stores(
	*stores: dict[str, dict[str, BucketAmounts]],
) -> dict[str, dict[str, BucketAmounts]]:
	"""Merge PB + GL stores by account/dim_key (amounts additive per field)."""
	out: dict[str, dict[str, BucketAmounts]] = {}
	for store in stores:
		for account, buckets in store.items():
			for _dim_key, bucket in buckets.items():
				target = _ensure_bucket(
					out,
					account,
					bucket.get("dimensions") or [],
					pb_docname=bucket.get("pb_docname"),
				)
				for key, value in bucket.items():
					if key in ("dimensions", "pb_docname"):
						continue
					if key.startswith(("plan_", "forecast_", "fact_")):
						target[key] = _to_float(target.get(key)) + _to_float(value)
	return out
