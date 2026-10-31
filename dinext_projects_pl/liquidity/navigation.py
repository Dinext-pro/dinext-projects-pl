"""Decorate only returned tree rows with permission-checked document destinations."""

from collections import defaultdict

import frappe

from .sources import Loader, chunks


def decorate_tree(rows, filters):
	loader = Loader(filters)
	by_type = defaultdict(lambda: defaultdict(list))

	def visit(branch):
		for row in branch:
			value = row["path"][-1]
			level = row["level"]
			if value and level in ("project", "contract"):
				doctype, name = ("Project" if level == "project" else "Contract"), value
			elif value and level in ("party", "order", "invoice", "payment"):
				doctype, name = value
			else:
				doctype, name = None, None
			if doctype and name:
				by_type[doctype][name].append(row)
			visit(row.get("children", []))

	visit(rows)
	for doctype, candidates in by_type.items():
		icon = frappe.get_meta(doctype).get("icon") or ""
		for batch in chunks(sorted(candidates)):
			for doc in loader.parents(doctype, ["name"], {"name": ["in", batch]}):
				for row in candidates[doc.name]:
					row["document"] = {"doctype": doctype, "name": doc.name}
					row["icon"] = icon
	return rows
