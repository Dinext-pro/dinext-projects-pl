# Copyright (c) 2026, Dinext
"""TypedDict для Project P&L grid v2 (scalar rows + periods)."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ViewMode = Literal["forecast_and_fact", "forecast_only", "fact_only"]


class PlV2GridFormInput(TypedDict, total=False):
	"""Входные параметры get_pl_grid_v2."""

	project: str
	period_type: str
	view_mode: ViewMode
	view_options: str


class PlV2SaveForecastChange(TypedDict, total=False):
	"""Одно изменение прогноза из P&L grid v2."""

	account: str
	dimensions: list[Any] | str | None
	period_key: str
	year: int
	month: int
	value: float | int | str


class PlV2SaveForecastFormInput(TypedDict, total=False):
	"""Входные параметры pl_v2_save_forecast_changes."""

	project: str
	changes: str | list[PlV2SaveForecastChange]


class PlV2DisplayPeriod(TypedDict):
	"""Период отображения (месяц)."""

	year: int
	month: int
	key: str
	is_past: bool


class PlV2Row(TypedDict, total=False):
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
	children: list[PlV2Row]
	summary_kind: str
	# периоды: plan_2026_7, forecast_2026_7, fact_2026_7, actual_2026_7, delta_2026_7
	# итого: plan_total, actual_total, delta_total


class PlV2GridResponse(TypedDict):
	"""Ответ get_pl_grid_v2."""

	project: str
	period_type: str
	view_mode: ViewMode
	periods: list[PlV2DisplayPeriod]
	rows: list[PlV2Row]
	summary_rows: list[PlV2Row]
