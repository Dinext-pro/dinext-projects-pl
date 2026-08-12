"""Post-migration setup for P&L-owned accounting dimensions."""

import frappe
from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
	make_dimension_in_accounting_doctypes,
)


PL_ACCOUNTING_DIMENSION_DOCUMENT_TYPES = (
	"Task",
	"Project Role",
	"Business Area",
	"Project Portfolio",
)


def sync_accounting_dimensions() -> None:
	"""Create generated dimension fields before dependent app tests run."""
	for name in frappe.get_all(
		"Accounting Dimension",
		filters={
			"document_type": ["in", PL_ACCOUNTING_DIMENSION_DOCUMENT_TYPES],
			"disabled": 0,
		},
		pluck="name",
	):
		make_dimension_in_accounting_doctypes(frappe.get_doc("Accounting Dimension", name))


OWNED_PROJECT_TEAM_FIELDS = (
	"virtual_worker",
	"base_cost_level",
	"pt_cost_level",
	"pt_category",
)


def detach_owned_project_team_fields() -> None:
	"""Detach DocFields re-owned as Custom Fields before fixture sync.

	CI still pins dinext_projects releases that define these as DocFields.
	`after_install` runs before sync_fixtures, so delete_fields makes install idempotent.
	"""
	from frappe.model import delete_fields

	delete_fields({"Project Team Details": list(OWNED_PROJECT_TEAM_FIELDS)}, delete=0)
	frappe.clear_cache(doctype="Project Team Details")


def after_install() -> None:
	detach_owned_project_team_fields()
