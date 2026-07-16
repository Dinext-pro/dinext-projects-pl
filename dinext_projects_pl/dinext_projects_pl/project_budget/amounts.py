# Copyright (c) 2026, Dinext
"""Загрузка plan/forecast/fact по account × dimension buckets для Project Budget grid."""

from __future__ import annotations

import frappe
from frappe.query_builder import DocType
from frappe.query_builder.functions import Coalesce, Sum
from frappe.utils import add_days, get_first_day, getdate

from dinext_projects_pl.models import BucketAmounts
from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import (
	dimension_fingerprint,
	normalize_dimensions,
)


def _to_float(value: object) -> float:
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def signed_gl_pl_amount(root_type: str | None, debit: object, credit: object) -> float:
	"""Income: credit - debit; Expense (default): debit - credit."""
	d = _to_float(debit)
	c = _to_float(credit)
	if root_type == "Income":
		return c - d
	return d - c


def period_date_bounds(periods: list[dict]) -> tuple[str | None, str | None]:
	if not periods:
		return None, None
	first = periods[0]
	last = periods[-1]
	start = f"{first['year']}-{int(first['month']):02d}-01"
	y, m = int(last["year"]), int(last["month"])
	if m == 12:
		end = f"{y}-12-31"
	else:
		next_first = get_first_day(f"{y}-{m + 1:02d}-01")
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
	"""account -> dim_key -> bucket with plan_/forecast_ fields (SQL, no N+1 get_doc)."""
	pb = DocType("Project Budget")
	pba = DocType("Project Budget Amount")

	pb_rows = (
		frappe.qb.from_(pb)
		.select(pb.name, pb.pb_account)
		.where(pb.pb_project == project)
		.run(as_dict=True)
	)
	if not pb_rows:
		return {}

	pb_account = {r.name: r.pb_account for r in pb_rows if r.pb_account}
	pb_names = list(pb_account.keys())
	dims_by_pb = _load_pb_dimensions_by_parent(pb_names)

	amount_rows = (
		frappe.qb.from_(pba)
		.select(
			pba.parent,
			pba.pba_year,
			pba.pba_month,
			Coalesce(pba.pba_plan, 0).as_("plan"),
			Coalesce(pba.pba_expected, 0).as_("forecast"),
		)
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
	"""account -> dim_key -> bucket with fact_ fields (Task dimension when set)."""
	store: dict[str, dict[str, BucketAmounts]] = {}
	if not start_date or not end_date:
		return store

	gle = DocType("GL Entry")
	select_fields = [gle.account, gle.posting_date, gle.debit, gle.credit]
	has_task = frappe.db.has_column("GL Entry", "task")
	if has_task:
		select_fields.append(gle.task)

	rows = (
		frappe.qb.from_(gle)
		.select(*select_fields)
		.where(gle.project == project)
		.where(gle.company == company)
		.where(gle.is_cancelled == 0)
		.where(gle.posting_date >= getdate(start_date))
		.where(gle.posting_date <= getdate(end_date))
		.run(as_dict=True)
	)

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
