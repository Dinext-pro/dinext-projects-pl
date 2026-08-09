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
