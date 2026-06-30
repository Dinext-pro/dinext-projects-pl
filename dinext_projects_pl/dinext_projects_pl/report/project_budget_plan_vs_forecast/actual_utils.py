# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe.utils import cstr, flt

from .filter_utils import get_company_names


def signed_pl_amount(root_type, debit, credit):
	"""Net P&L actual from GL amounts by account root type."""
	d = flt(debit)
	c = flt(credit)
	if root_type == "Income":
		return round(c - d, 0)
	if root_type == "Expense":
		return round(d - c, 0)
	return round(d - c, 0)


def append_finance_book_sql(conditions, filter_values, filters, gle_column="gle.finance_book"):
	"""Append finance book filter matching GL drilldown (include default book entries)."""
	companies = get_company_names(filters)
	if not companies:
		return

	finance_books = []
	for company in companies:
		fb = frappe.get_cached_value("Company", company, "default_finance_book")
		if fb and cstr(fb) not in finance_books:
			finance_books.append(cstr(fb))

	if len(finance_books) == 1:
		filter_values["company_fb"] = finance_books[0]
		conditions.append(f"({gle_column} IN (%(company_fb)s, '') OR {gle_column} IS NULL)")
	elif finance_books:
		filter_values["company_fb"] = tuple(finance_books + [""])
		conditions.append(f"({gle_column} IN %(company_fb)s OR {gle_column} IS NULL)")
	else:
		conditions.append(f"({gle_column} = '' OR {gle_column} IS NULL)")
