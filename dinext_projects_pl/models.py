# Copyright (c) 2026, Dinext
"""TypedDict models for dinext_projects_pl (API + domain packages)."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ViewMode = Literal["forecast_and_fact", "forecast_only", "fact_only"]


class ProjectBudgetGridFormInput(TypedDict, total=False):
	"""Входные параметры get_project_budget_grid."""

	project: str
	period_type: str
	view_mode: ViewMode
	view_options: str
	show_zero_rows: bool | int | str


class ProjectBudgetSaveForecastChange(TypedDict, total=False):
	"""Одно изменение прогноза из Project Budget grid."""

	account: str
	dimensions: list[Any] | str | None
	period_key: str
	year: int
	month: int
	value: float | int | str


class ProjectBudgetSaveForecastFormInput(TypedDict, total=False):
	"""Входные параметры save_project_budget_forecast."""

	project: str
	changes: str | list[ProjectBudgetSaveForecastChange]


class ProjectBudgetDisplayPeriod(TypedDict, total=False):
	"""Период отображения (month / quarter / year)."""

	year: int
	month: int
	quarter: int
	key: str
	label: str
	is_past: bool
	monthly_keys: list[str]


class ProjectBudgetRow(TypedDict, total=False):
	"""Одна строка grid: account / task / risk tree node."""

	id: str
	account: str
	account_label: str | None
	parent_account: str | None
	dimensions: list[Any]
	has_children: bool
	indent: int
	expandable: int | bool
	task: str
	risk: str
	root_type: str
	pb_docname: str
	children: list[ProjectBudgetRow]
	summary_kind: str
	# периоды: plan_2026_7, forecast_2026_7, fact_2026_7, actual_2026_7, delta_2026_7
	# итого: plan_total, actual_total, delta_total


class ProjectBudgetGridResponse(TypedDict, total=False):
	"""Ответ get_project_budget_grid."""

	project: str
	period_type: str
	view_mode: ViewMode
	show_zero_rows: bool
	periods: list[ProjectBudgetDisplayPeriod]
	rows: list[ProjectBudgetRow]
	summary_rows: list[ProjectBudgetRow]


class BucketAmounts(TypedDict, total=False):
	"""Amounts bucket keyed by dimension fingerprint (Project Budget grid)."""

	dimensions: list[dict[str, str]]
	pb_docname: str | None
