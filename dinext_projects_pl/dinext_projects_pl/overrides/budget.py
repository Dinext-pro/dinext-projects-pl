"""Budget override for Dinext approval semantics."""

from __future__ import annotations

import frappe
from erpnext.accounts.doctype.budget.budget import Budget as ERPNextBudget
from erpnext.accounts.doctype.budget.budget import DuplicateBudgetError
from frappe import _

from dinext_projects_pl.dinext_projects_pl.budget_approval.group_account_budget import (
    validate_budget_account_allowed,
    validate_budget_account_hierarchy,
)
from dinext_projects_pl.dinext_projects_pl.budget_approval.bootstrap import (
    BUDGET_WORKFLOW_STATE_FIELD,
    STATE_APPROVED,
    STATE_CANCELLED_DRAFT,
)


class Budget(ERPNextBudget):
    def validate_accounts(self):
        account_list = []
        for row in self.get("accounts"):
            if not row.account:
                continue

            validate_budget_account_allowed(row.account, self.company)
            if row.account in account_list:
                frappe.throw(_("Account {0} has been entered multiple times").format(row.account))
            account_list.append(row.account)

        validate_budget_account_hierarchy(self)

    def validate_duplicate(self):
        budget_against_field = frappe.scrub(self.budget_against)
        budget_against = self.get(budget_against_field)
        accounts = [row.account for row in self.accounts] or []
        if not accounts:
            return

        filters = {
            "company": self.company,
            budget_against_field: budget_against,
            "fiscal_year": self.fiscal_year,
            "docstatus": ["<", 2],
            "name": ["!=", self.name],
        }
        existing_budget_rows = frappe.get_all("Budget", filters=filters, fields=["name"])

        for row in existing_budget_rows:
            budget = frappe.get_doc("Budget", row.name)
            workflow_state = getattr(budget, BUDGET_WORKFLOW_STATE_FIELD, None)
            if budget.docstatus == 0 and workflow_state == STATE_CANCELLED_DRAFT:
                continue
            if budget.docstatus == 1 and workflow_state == STATE_APPROVED:
                continue

            for account_row in budget.accounts:
                if account_row.account not in accounts:
                    continue

                frappe.throw(
                    _(
                        "Another Budget record '{0}' already exists against {1} '{2}' and account '{3}' for fiscal year {4}"
                    ).format(
                        budget.name,
                        self.budget_against,
                        budget_against,
                        account_row.account,
                        self.fiscal_year,
                    ),
                    DuplicateBudgetError,
                )
