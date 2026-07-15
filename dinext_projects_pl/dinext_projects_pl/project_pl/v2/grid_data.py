# Copyright (c) 2026, Dinext
"""Сборка scalar P&L grid v2.

Дерево строк как legacy StickyDataTable: CoA + Task + Project Risk.
Без cell merge. Периоды — атомарные plan/actual/delta.
"""

from __future__ import annotations

import frappe
from frappe import _

from dinext_projects_pl.dinext_projects_pl.project_pl.v2.amounts import (
	load_budget_buckets,
	load_gl_fact_buckets,
	merge_bucket_stores,
	period_date_bounds,
)
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.dimensions import (
	dimension_fingerprint,
	normalize_dimensions,
)
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.models import (
	PlV2DisplayPeriod,
	PlV2GridFormInput,
	PlV2GridResponse,
	PlV2Row,
	ViewMode,
)
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.periods import (
	get_display_periods,
	normalize_view_mode,
)
from dinext_projects_pl.dinext_projects_pl.project_pl.v2.summary import build_pl_v2_summary_rows

RISK_KEY_SEP = "|risk|"
EXCLUDED_DIMENSIONS = ("Project", "Cost Center", "Project Portfolio")


def _to_float(value: object) -> float:
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def _calc_delta_pct(plan: float, actual: float) -> float:
	if not plan:
		return 0.0
	return round(((actual - plan) / plan) * 100, 1)


def _resolve_actual(
	forecast: float,
	fact: float,
	is_past: bool,
	view_mode: ViewMode,
) -> float:
	if view_mode == "forecast_only":
		return forecast
	if view_mode == "fact_only":
		return fact
	return fact if is_past else forecast


def _load_pl_accounts(company: str) -> list[dict]:
	# Same order as legacy load_budget_data (project_pl.js): root_type desc.
	return frappe.get_all(
		"Account",
		filters={
			"disabled": 0,
			"report_type": "Profit and Loss",
			"company": company,
		},
		fields=[
			"name",
			"account_name",
			"is_group",
			"parent_account",
			"root_type",
		],
		order_by="root_type desc",
		limit_page_length=0,
	)


def _load_project_tasks(project: str) -> list[dict]:
	"""Task tree for P&L expansion — same filters/order as WE consolidated."""
	Task = frappe.qb.DocType("Task")
	tasks = (
		frappe.qb.from_(Task)
		.select(
			Task.name.as_("value"),
			Task.subject,
			Task.is_group.as_("expandable"),
			Task.parent_task,
		)
		.where(Task.project == project)
		.where(Task.docstatus < 2)
		.where(Task.is_milestone == 0)
		.orderby(Task.parent_task)
		.orderby(Task.exp_start_date)
		.orderby(Task.exp_end_date)
		.run(as_dict=True)
	)
	if not tasks:
		return []

	task_dict = {t["value"]: t for t in tasks}
	child_map: dict[str, list[str]] = {}
	for task in tasks:
		parent = task.get("parent_task") or ""
		child_map.setdefault(parent, []).append(task["value"])

	ordered: list[dict] = []

	def walk(parent_id: str, level: int) -> None:
		for child_id in child_map.get(parent_id, []):
			task = task_dict.get(child_id)
			if not task:
				continue
			task["indent"] = level
			ordered.append(task)
			walk(child_id, level + 1)

	for root_id in child_map.get("", []):
		task = task_dict.get(root_id)
		if not task:
			continue
		task["indent"] = 0
		ordered.append(task)
		walk(root_id, 1)

	return ordered


def _load_accounts_allowing_task(company: str) -> set[str]:
	"""Accounts where Accounting Dimension Filter allows document_type Task."""
	filters = frappe.get_all(
		"Accounting Dimension Filter",
		filters={"company": company, "disabled": 0},
		fields=["name", "accounting_dimension"],
		limit_page_length=0,
	)
	allowed: set[str] = set()
	for filt in filters:
		dim_name = filt.get("accounting_dimension") or ""
		if not dim_name or dim_name in EXCLUDED_DIMENSIONS:
			continue
		doc_type = frappe.db.get_value("Accounting Dimension", dim_name, "document_type")
		if doc_type != "Task":
			continue
		for acct in frappe.get_all(
			"Applicable On Account",
			filters={"parent": filt.name},
			pluck="applicable_on_account",
			limit_page_length=0,
		):
			if acct:
				allowed.add(acct)
	return allowed


def _load_risk_titles(project_doc) -> dict[str, str]:
	titles: dict[str, str] = {}
	for row in project_doc.get("custom_project_risks") or []:
		name = row.get("name")
		if not name:
			continue
		titles[str(name)] = str(row.get("subject") or name)
	return titles


def _bucket_has_doc(bucket: dict, doc: str) -> bool:
	for dim in bucket.get("dimensions") or []:
		if dim.get("doc") == doc:
			return True
	return False


def _risk_docname(bucket: dict) -> str | None:
	for dim in bucket.get("dimensions") or []:
		if dim.get("doc") == "Project Risk":
			return dim.get("docname")
	return None


def _strip_dims(dimensions: list[dict], drop_docs: set[str]) -> list[dict]:
	return normalize_dimensions(
		[d for d in (dimensions or []) if d.get("doc") not in drop_docs]
	)


def _sum_bucket_amounts(target: dict, bucket: dict) -> None:
	for key, value in bucket.items():
		if key in ("dimensions", "pb_docname"):
			continue
		if key.startswith(("plan_", "forecast_", "fact_")):
			target[key] = _to_float(target.get(key)) + _to_float(value)


def _collapse_task_buckets(buckets: list[dict]) -> list[dict]:
	"""Legacy: when Task not allowed, fold Task buckets into non-Task dims."""
	merged: dict[str, dict] = {}
	order: list[str] = []
	for bucket in buckets:
		dims = _strip_dims(bucket.get("dimensions") or [], {"Task"})
		key = dimension_fingerprint(dims)
		if key not in merged:
			merged[key] = {"dimensions": dims, "pb_docname": bucket.get("pb_docname")}
			order.append(key)
		elif bucket.get("pb_docname") and not merged[key].get("pb_docname"):
			merged[key]["pb_docname"] = bucket.get("pb_docname")
		_sum_bucket_amounts(merged[key], bucket)
	return [merged[k] for k in order]


def _apply_amounts_from_buckets(
	row: PlV2Row,
	buckets: list[dict],
	periods: list[PlV2DisplayPeriod],
	view_mode: ViewMode,
) -> None:
	combined: dict = {}
	pb_docname = None
	for bucket in buckets:
		_sum_bucket_amounts(combined, bucket)
		if not pb_docname and bucket.get("pb_docname"):
			pb_docname = bucket.get("pb_docname")
	if pb_docname:
		row["pb_docname"] = pb_docname

	for period in periods:
		key = period["key"]
		plan = _to_float(combined.get(f"plan_{key}"))
		forecast = _to_float(combined.get(f"forecast_{key}"))
		fact = _to_float(combined.get(f"fact_{key}"))
		actual = _resolve_actual(forecast, fact, period["is_past"], view_mode)
		row[f"plan_{key}"] = plan  # type: ignore[literal-required]
		row[f"forecast_{key}"] = forecast  # type: ignore[literal-required]
		row[f"fact_{key}"] = fact  # type: ignore[literal-required]
		# Own bucket fact (before tree rollup) — save-plan must not use rolled head totals.
		row[f"own_fact_{key}"] = fact  # type: ignore[literal-required]
		row[f"actual_{key}"] = actual  # type: ignore[literal-required]
		row[f"delta_{key}"] = _calc_delta_pct(plan, actual)  # type: ignore[literal-required]
	_apply_row_totals(row, periods)


def _apply_row_totals(row: PlV2Row, periods: list[PlV2DisplayPeriod]) -> None:
	plan_total = 0.0
	actual_total = 0.0
	for period in periods:
		key = period["key"]
		plan_total += _to_float(row.get(f"plan_{key}"))
		actual_total += _to_float(row.get(f"actual_{key}"))
	row["plan_total"] = plan_total  # type: ignore[literal-required]
	row["actual_total"] = actual_total  # type: ignore[literal-required]
	row["delta_total"] = _calc_delta_pct(plan_total, actual_total)  # type: ignore[literal-required]


def _add_fact_from_child(
	parent: PlV2Row,
	child: PlV2Row,
	periods: list[PlV2DisplayPeriod],
	view_mode: ViewMode,
) -> None:
	for period in periods:
		key = period["key"]
		field = f"fact_{key}"
		parent[field] = _to_float(parent.get(field)) + _to_float(child.get(field))  # type: ignore[literal-required]
		plan = _to_float(parent.get(f"plan_{key}"))
		forecast = _to_float(parent.get(f"forecast_{key}"))
		fact = _to_float(parent.get(field))
		actual = _resolve_actual(forecast, fact, period["is_past"], view_mode)
		parent[f"actual_{key}"] = actual  # type: ignore[literal-required]
		parent[f"delta_{key}"] = _calc_delta_pct(plan, actual)  # type: ignore[literal-required]
	_apply_row_totals(parent, periods)


def _split_risk_buckets(
	buckets: list[dict],
) -> tuple[list[dict], list[tuple[str, dict]]]:
	"""Return (kept_buckets, [(risk_docname, bucket), ...])."""
	kept: list[dict] = []
	risks: list[tuple[str, dict]] = []
	seen_risk: set[str] = set()
	for bucket in buckets:
		risk_name = _risk_docname(bucket)
		if not risk_name:
			kept.append(bucket)
			continue
		if risk_name not in seen_risk:
			seen_risk.add(risk_name)
			risks.append((risk_name, bucket))
	return kept, risks


def _make_base_row(
	*,
	row_id: str,
	account: str,
	account_label: str,
	parent_account: str | None,
	dimensions: list[dict],
	indent: int,
	root_type: str | None,
	task: str | None = None,
	risk: str | None = None,
) -> PlV2Row:
	row: PlV2Row = {
		"id": row_id,
		"account": account,
		"account_label": account_label,
		"parent_account": parent_account,
		"dimensions": dimensions,
		"has_children": False,
		"indent": indent,
		"expandable": 0,
	}
	if root_type:
		row["root_type"] = root_type
	if task:
		row["task"] = task
	if risk:
		row["risk"] = risk
	return row


def _build_risk_rows(
	*,
	parent_id: str,
	account: str,
	root_type: str | None,
	indent: int,
	risk_buckets: list[tuple[str, dict]],
	periods: list[PlV2DisplayPeriod],
	view_mode: ViewMode,
	risk_titles: dict[str, str],
) -> list[PlV2Row]:
	rows: list[PlV2Row] = []
	for risk_name, bucket in risk_buckets:
		label = f"⚠ {risk_titles.get(risk_name) or risk_name}"
		row = _make_base_row(
			row_id=f"{parent_id}{RISK_KEY_SEP}{risk_name}",
			account=account,
			account_label=label,
			parent_account=None,
			dimensions=bucket.get("dimensions") or [],
			indent=indent,
			root_type=root_type,
			risk=risk_name,
		)
		_apply_amounts_from_buckets(row, [bucket], periods, view_mode)
		rows.append(row)
	return rows


def _build_tree_rows(
	accounts: list[dict],
	tasks: list[dict],
	task_allowed_accounts: set[str],
	periods: list[PlV2DisplayPeriod],
	view_mode: ViewMode,
	buckets_by_account: dict[str, dict[str, dict]],
	risk_titles: dict[str, str],
) -> list[PlV2Row]:
	by_parent: dict[str | None, list[dict]] = {}
	for acc in accounts:
		parent = acc.get("parent_account") or None
		by_parent.setdefault(parent, []).append(acc)

	account_names = {a["name"] for a in accounts}
	roots = [
		a
		for a in accounts
		if not a.get("parent_account") or a["parent_account"] not in account_names
	]

	def children_of(parent_name: str | None) -> list[dict]:
		if parent_name is None:
			return roots
		return by_parent.get(parent_name, [])

	def account_buckets_list(account_name: str) -> list[dict]:
		raw = list((buckets_by_account.get(account_name) or {}).values())
		if not raw:
			return [{"dimensions": []}]
		return raw

	def walk_tasks(
		account_name: str,
		root_type: str | None,
		parent_task: str | None,
		indent: int,
		account_task_buckets: dict[str, list[dict]],
	) -> list[PlV2Row]:
		rows: list[PlV2Row] = []
		for task in tasks:
			task_parent = task.get("parent_task") or None
			if (task_parent or None) != parent_task:
				continue
			task_name = task["value"]
			buckets = list(account_task_buckets.get(task_name) or [])
			if not buckets:
				buckets = [{"dimensions": [{"doc": "Task", "docname": task_name}]}]

			kept, risk_parts = _split_risk_buckets(buckets)
			row_id = f"{account_name}{task_name}"
			row = _make_base_row(
				row_id=row_id,
				account=account_name,
				account_label=task.get("subject") or task_name,
				parent_account=None,
				dimensions=kept[0].get("dimensions") if kept else [{"doc": "Task", "docname": task_name}],
				indent=indent,
				root_type=root_type,
				task=task_name,
			)
			_apply_amounts_from_buckets(row, kept or buckets, periods, view_mode)

			nested_tasks = walk_tasks(
				account_name,
				root_type,
				task_name,
				indent + 1,
				account_task_buckets,
			)
			risk_rows = _build_risk_rows(
				parent_id=row_id,
				account=account_name,
				root_type=root_type,
				indent=indent + 1,
				risk_buckets=risk_parts,
				periods=periods,
				view_mode=view_mode,
				risk_titles=risk_titles,
			)
			# Legacy sibling order under task: child tasks, then risks.
			children = nested_tasks + risk_rows
			for child in children:
				_add_fact_from_child(row, child, periods, view_mode)
			if children:
				row["children"] = children
				row["has_children"] = True
				row["expandable"] = 1
			rows.append(row)
		return rows

	def walk_accounts(parent_name: str | None, indent: int) -> list[PlV2Row]:
		rows: list[PlV2Row] = []
		for acc in children_of(parent_name):
			name = acc["name"]
			raw_buckets = account_buckets_list(name)
			allows_task = name in task_allowed_accounts

			task_bucket_map: dict[str, list[dict]] = {}
			non_task: list[dict] = []

			if allows_task:
				for bucket in raw_buckets:
					if _bucket_has_doc(bucket, "Task"):
						for dim in bucket.get("dimensions") or []:
							if dim.get("doc") == "Task" and dim.get("docname"):
								task_bucket_map.setdefault(dim["docname"], []).append(bucket)
								break
					else:
						non_task.append(bucket)
				if not non_task:
					non_task = [{"dimensions": []}]
			else:
				non_task = _collapse_task_buckets(raw_buckets)
				if not non_task:
					non_task = [{"dimensions": []}]

			kept, risk_parts = _split_risk_buckets(non_task)
			if not kept:
				kept = [{"dimensions": []}]

			row = _make_base_row(
				row_id=name,
				account=name,
				account_label=acc.get("account_name") or name,
				parent_account=acc.get("parent_account"),
				dimensions=kept[0].get("dimensions") or [],
				indent=indent,
				root_type=acc.get("root_type"),
			)
			_apply_amounts_from_buckets(row, kept, periods, view_mode)

			# Legacy under account: root tasks, then child accounts, then risks.
			task_rows: list[PlV2Row] = []
			if allows_task and tasks:
				task_rows = walk_tasks(
					name,
					acc.get("root_type"),
					None,
					indent + 1,
					task_bucket_map,
				)

			nested_accounts = walk_accounts(name, indent + 1)
			risk_rows = _build_risk_rows(
				parent_id=name,
				account=name,
				root_type=acc.get("root_type"),
				indent=indent + 1,
				risk_buckets=risk_parts,
				periods=periods,
				view_mode=view_mode,
				risk_titles=risk_titles,
			)

			children = task_rows + nested_accounts + risk_rows
			for child in children:
				_add_fact_from_child(row, child, periods, view_mode)
			if children:
				row["children"] = children
				row["has_children"] = True
				row["expandable"] = 1
			rows.append(row)
		return rows

	return walk_accounts(None, 0)


def run_get_pl_grid_v2(form_input: PlV2GridFormInput) -> PlV2GridResponse:
	project = form_input.get("project")
	if not project:
		frappe.throw(_("Project is required"))

	if not frappe.has_permission("Project", "read", project):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	project_doc = frappe.get_cached_doc("Project", project)
	company = project_doc.company
	if not company:
		frappe.throw(_("Project company is required"))

	period_type = form_input.get("period_type") or "month"
	view_mode = normalize_view_mode(
		form_input.get("view_options"),
		form_input.get("view_mode"),
	)
	periods = get_display_periods(project, period_type, view_mode)
	accounts = _load_pl_accounts(company)
	root_types = {a["name"]: a.get("root_type") or "" for a in accounts}

	start_date, end_date = period_date_bounds(periods)
	budget_buckets = load_budget_buckets(project)
	gl_buckets = load_gl_fact_buckets(
		project, company, start_date, end_date, root_types
	)
	buckets_by_account = merge_bucket_stores(budget_buckets, gl_buckets)

	tasks = _load_project_tasks(project)
	task_allowed = _load_accounts_allowing_task(company)
	risk_titles = _load_risk_titles(project_doc)

	rows = _build_tree_rows(
		accounts,
		tasks,
		task_allowed,
		periods,
		view_mode,
		buckets_by_account,
		risk_titles,
	)
	summary_rows = build_pl_v2_summary_rows(rows, periods)

	return {
		"project": project,
		"period_type": period_type,
		"view_mode": view_mode,
		"periods": periods,
		"rows": rows,
		"summary_rows": summary_rows,
	}
