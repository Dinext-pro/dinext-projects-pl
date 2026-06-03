"""Constants for Budget approval workflow metadata."""

BUDGET_WORKFLOW_NAME = "Dinext Budget Approval"
BUDGET_WORKFLOW_STATE_FIELD = "workflow_state"
BUDGET_ACCOUNT_FIELD = "dinext_budget_account"
BUDGET_MONTHLY_AMOUNTS_FIELD = "dinext_budget_monthly_amounts"

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
