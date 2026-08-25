# Copyright (c) 2026, Dinext
"""Plan envelope: display rollup + parent own >= children sum.

own_plan > 0 = explicit envelope (shown as-is).
own_plan == 0 = no envelope (display = children sum; writing 0 is allowed).
"""

from __future__ import annotations

from copy import deepcopy

import frappe
from frappe import _
from frappe.utils import flt

from dinext_projects_pl.dinext_projects_pl.project_budget.dimensions import (
	dimension_fingerprint,
	normalize_dimensions,
)
from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import _rollup_parent_plan
from dinext_projects_pl.models import ProjectBudgetRow


def _to_float(value: object) -> float:
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def _flatten_rows(rows: list[ProjectBudgetRow]) -> list[ProjectBudgetRow]:
	out: list[ProjectBudgetRow] = []
	for row in rows or []:
		out.append(row)
		out.extend(_flatten_rows(list(row.get("children") or [])))
	return out


def _row_match_key(account: object, dimensions: object) -> tuple[str, str]:
	return (
		str(account or "").strip(),
		dimension_fingerprint(normalize_dimensions(dimensions if isinstance(dimensions, list) else [])),
	)


def _period_key(year: object, month: object) -> str:
	return f"{int(year)}_{int(month)}"


def overlay_own_plans(rows: list[ProjectBudgetRow], writes: list[dict]) -> list[str]:
	"""Apply save-plan writes onto own_plan_*. Returns touched period keys."""
	index = {
		_row_match_key(row.get("account"), row.get("dimensions")): row
		for row in _flatten_rows(rows)
		if not row.get("summary_kind")
	}
	keys: list[str] = []
	seen: set[str] = set()
	for write in writes or []:
		row = index.get(_row_match_key(write.get("account"), write.get("dimensions")))
		for amount in write.get("amounts") or []:
			year = amount.get("year")
			month = amount.get("month")
			if not year or not month:
				continue
			key = _period_key(year, month)
			if key not in seen:
				seen.add(key)
				keys.append(key)
			if row is None:
				continue
			row[f"own_plan_{key}"] = _to_float(amount.get("plan_value"))  # type: ignore[literal-required]
	return keys


def rollup_display_plan(rows: list[ProjectBudgetRow], period_keys: list[str]) -> None:
	"""Bottom-up: leaf plan = own; parent = own envelope or children display sum."""
	for row in rows or []:
		children = list(row.get("children") or [])
		rollup_display_plan(children, period_keys)
		if children:
			_rollup_parent_plan(row, children, period_keys)
			continue
		for key in period_keys:
			row[f"plan_{key}"] = _to_float(row.get(f"own_plan_{key}"))  # type: ignore[literal-required]


def find_plan_envelope_error(rows: list[ProjectBudgetRow], period_keys: list[str]) -> str | None:
	"""If own_plan > 0, it must be >= sum of child display plans for that period."""
	for row in _flatten_rows(rows):
		if row.get("summary_kind"):
			continue
		children = list(row.get("children") or [])
		if not children:
			continue
		for key in period_keys:
			own = _to_float(row.get(f"own_plan_{key}"))
			if own <= 0:
				continue
			child_sum = sum(_to_float(child.get(f"plan_{key}")) for child in children)
			if own + 1e-9 < child_sum:
				label = row.get("account_label") or row.get("account") or ""
				return _(
					"{0}: value cannot be less than the sum of child items ({1})"
				).format(label, f"{flt(child_sum, 2):g}")
	return None


def validate_plan_writes(rows: list[ProjectBudgetRow], writes: list[dict]) -> str | None:
	"""Overlay writes on a cloned tree, re-rollup, return error message or None."""
	if not writes:
		return None
	cloned: list[ProjectBudgetRow] = deepcopy(rows or [])
	period_keys = overlay_own_plans(cloned, writes)
	if not period_keys:
		return None
	rollup_display_plan(cloned, period_keys)
	return find_plan_envelope_error(cloned, period_keys)


def validate_project_plan_writes(project: str, writes: list[dict]) -> None:
	"""Load month grid and throw if writes break parent plan envelopes."""
	if not project or not writes:
		return

	from dinext_projects_pl.dinext_projects_pl.project_budget.grid_data import (
		run_get_project_budget_grid,
	)

	grid = run_get_project_budget_grid(
		{
			"project": project,
			"period_type": "month",
			"show_zero_rows": 1,
		}
	)
	error = validate_plan_writes(list(grid.get("rows") or []), writes)
	if error:
		frappe.throw(error)
