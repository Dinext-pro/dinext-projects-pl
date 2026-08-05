# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe import _

from .filter_utils import normalize_filters


def validate_filters(filters):
    normalize_filters(filters)

    if not filters.get("from_year"):
        frappe.throw(_("Please select From Period"))
    if not filters.get("to_year"):
        frappe.throw(_("Please select To Period"))
