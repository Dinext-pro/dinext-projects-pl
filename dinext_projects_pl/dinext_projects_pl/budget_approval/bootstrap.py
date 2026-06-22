"""Constants for Budget approval workflow metadata."""

import frappe
from frappe.utils import cint

BUDGET_WORKFLOW_NAME = "Dinext Budget Approval"
BUDGET_WORKFLOW_STATE_FIELD = "workflow_state"
BUDGET_ACCOUNT_FIELD = "dinext_budget_account"
BUDGET_MONTHLY_AMOUNTS_FIELD = "dinext_budget_monthly_amounts"
PLAN_APPROVAL_SITE_CONFIG_KEY = "dinext_projects_pl_enable_plan_approval"

ROLE_BUDGET_SUBMITTER = "Dinext_Project_Manager"
ROLE_BUDGET_APPROVER = "Dinext_Budget_Approver"

STATE_DRAFT = "Draft"
STATE_PENDING_APPROVAL = "Pending Approval"
STATE_APPROVED = "Approved"
STATE_CANCELLED_DRAFT = "Cancelled Draft"
STATE_CANCELLED_APPROVED = "Cancelled Approved"

ACTION_SUBMIT_FOR_APPROVAL = "Submit for Approval"
ACTION_APPROVE = "Approve"
ACTION_CANCEL = "Cancel"


def is_plan_approval_enabled() -> bool:
    """Return site-level toggle for P&L plan approval flow."""
    return bool(cint(frappe.conf.get(PLAN_APPROVAL_SITE_CONFIG_KEY, 1)))
