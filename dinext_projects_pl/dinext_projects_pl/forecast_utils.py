import json

import frappe


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_income_accounts_with_task_dimension(doctype, txt, searchfield, start, page_len, filters):
    """Доходные счета с измерением Task для компании проекта."""
    if isinstance(filters, str):
        filters = json.loads(filters) if filters else {}

    company = filters.get("company")
    if not company:
        return []

    dim_filters = frappe.get_all(
        "Accounting Dimension Filter",
        filters={"accounting_dimension": "Task", "disabled": 0, "company": company},
        pluck="name",
    )
    if not dim_filters:
        return []

    applicable_accounts = frappe.get_all(
        "Applicable On Account",
        filters={"parent": ["in", dim_filters]},
        pluck="applicable_on_account",
    )
    if not applicable_accounts:
        return []

    if txt:
        applicable_accounts = [
            name for name in applicable_accounts if txt.lower() in name.lower()
        ]
        if not applicable_accounts:
            return []

    accounts = frappe.get_all(
        "Account",
        filters={
            "name": ["in", applicable_accounts],
            "root_type": "Income",
            "is_group": 0,
            "company": company,
        },
        fields=["name"],
        limit_start=start,
        limit_page_length=page_len or 9999,
    )
    return [[acc.name] for acc in accounts]
