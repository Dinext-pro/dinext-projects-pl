# Copyright (c) 2026, Dinext
"""Dimension fingerprint for P&L grid v2."""

from __future__ import annotations

from typing import Any

DimItem = dict[str, str]


def normalize_dimensions(raw: list[Any] | None) -> list[DimItem]:
	"""Stable list of {doc, docname}, sorted by doc then docname."""
	items: list[DimItem] = []
	for item in raw or []:
		if not isinstance(item, dict):
			continue
		doc = (item.get("doc") or "").strip()
		docname = (item.get("docname") or "").strip()
		if not doc or not docname:
			continue
		items.append({"doc": doc, "docname": docname})
	items.sort(key=lambda d: (d["doc"], d["docname"]))
	return items


def dimension_fingerprint(dimensions: list[DimItem] | None) -> str:
	"""Stable id key. No `:` — DinextTable tree path splits on colon."""
	dims = normalize_dimensions(dimensions)
	if not dims:
		return ""
	return "|".join(f"{d['doc']}\x1f{d['docname']}" for d in dims)
