"""Group-account Budget helpers owned by Dinext Projects."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import frappe
from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
    get_accounting_dimensions,
)
from erpnext.accounts.doctype.budget.budget import (
    BudgetError,
    get_accumulated_monthly_budget,
    get_item_details,
)
from erpnext.accounts.utils import get_fiscal_year
from frappe import _
from frappe.utils import flt, fmt_money, get_last_day, getdate

from dinext_projects_pl.dinext_projects_pl.budget_approval.bootstrap import (
    BUDGET_WORKFLOW_STATE_FIELD,
    STATE_CANCELLED_DRAFT,
)

EXPENSE_ROOT_TYPE = "Expense"
PROFIT_AND_LOSS = "Profit and Loss"
MONTH_NAMES = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}


@dataclass(frozen=True)
class BudgetScope:
    company: str
    fiscal_year: str
    budget_against: str
    budget_against_field: str
    target_name: str


@dataclass
class BudgetAccountRow:
    budget_name: str
    account: str
    budget_amount: float
    monthly_distribution: str | None
    budget_against_value: str
    budget_doc: object | None = None


@lru_cache(maxsize=2048)
def get_account_details(account: str) -> frappe._dict:
    details = frappe.db.get_value(
        "Account",
        account,
        [
            "name",
            "company",
            "report_type",
            "root_type",
            "is_group",
            "lft",
            "rgt",
            "custom_not_plan_exp",
        ],
        as_dict=True,
    )
    if not details:
        frappe.throw(_("Account {0} does not exist").format(account))
    return frappe._dict(details)


def clear_group_budget_caches() -> None:
    get_account_details.cache_clear()
    get_descendant_account_names.cache_clear()
    get_dimension_descendant_names.cache_clear()


def validate_budget_account_allowed(account: str, company: str) -> None:
    details = get_account_details(account)
    if details.company != company:
        frappe.throw(_("Account {0} does not belongs to company {1}").format(account, company))
    if details.report_type != PROFIT_AND_LOSS:
        frappe.throw(
            _("Budget cannot be assigned against {0}, as it's not an Income or Expense account").format(account)
        )
    if flt(details.custom_not_plan_exp):
        frappe.throw(_("Budget planning is disabled for Account {0}").format(account))


def is_account_in_subtree(account: str, budget_account: str) -> bool:
    account_details = get_account_details(account)
    budget_details = get_account_details(budget_account)
    return (
        account_details.company == budget_details.company
        and account_details.lft >= budget_details.lft
        and account_details.rgt <= budget_details.rgt
    )


@lru_cache(maxsize=1024)
def get_descendant_account_names(account: str) -> tuple[str, ...]:
    details = get_account_details(account)
    return tuple(
        frappe.get_all(
            "Account",
            filters={
                "company": details.company,
                "lft": [">=", details.lft],
                "rgt": ["<=", details.rgt],
                "disabled": 0,
            },
            pluck="name",
        )
    )


@lru_cache(maxsize=1024)
def get_dimension_descendant_names(doctype: str, name: str) -> tuple[str, ...]:
    if not frappe.get_cached_value("DocType", doctype, "is_tree"):
        return (name,)
    lft, rgt = frappe.db.get_value(doctype, name, ["lft", "rgt"]) or (None, None)
    if lft is None or rgt is None:
        return (name,)
    return tuple(
        frappe.get_all(
            doctype,
            filters={
                "lft": [">=", lft],
                "rgt": ["<=", rgt],
            },
            pluck="name",
        )
    )


def get_budget_scope(doc) -> BudgetScope:
    budget_against_field = frappe.scrub(doc.budget_against)
    return BudgetScope(
        company=doc.company,
        fiscal_year=doc.fiscal_year,
        budget_against=doc.budget_against,
        budget_against_field=budget_against_field,
        target_name=doc.get(budget_against_field),
    )


def validate_budget_account_hierarchy(doc) -> None:
    scope = get_budget_scope(doc)
    if not scope.target_name:
        return

    rows = _get_budget_account_rows_for_scope(scope, current_doc=doc, include_drafts=True)
    account_details = {row.account: get_account_details(row.account) for row in rows}

    for parent_row in rows:
        parent_details = account_details[parent_row.account]
        if not parent_details.is_group:
            continue

        child_sum = 0.0
        for child_row in rows:
            if child_row.account == parent_row.account:
                continue
            child_details = account_details[child_row.account]
            if not _is_descendant(child_details, parent_details):
                continue
            if _has_budgeted_account_between(parent_details, child_details, rows, account_details):
                continue
            child_sum += flt(child_row.budget_amount)

        if child_sum > flt(parent_row.budget_amount):
            frappe.throw(
                _(
                    "Budget for parent Account {0} ({1}) cannot be less than the sum of child budgets ({2})"
                ).format(
                    parent_row.account,
                    flt(parent_row.budget_amount),
                    flt(child_sum),
                )
            )


def validate_group_budget_for_document(doc, _method=None) -> None:
    if doc.doctype == "Material Request":
        if doc.material_request_type != "Purchase":
            return
        posting_date = getattr(doc, "schedule_date", None) or getdate()
        for row in doc.get("items") or []:
            args = frappe._dict(row.as_dict())
            args.update(
                {
                    "doctype": doc.doctype,
                    "company": doc.company,
                    "posting_date": posting_date,
                }
            )
            validate_group_budget_for_args(args)
        return

    if doc.doctype == "Purchase Order":
        for row in doc.get("items") or []:
            args = frappe._dict(row.as_dict())
            args.update(
                {
                    "doctype": doc.doctype,
                    "company": doc.company,
                    "posting_date": doc.transaction_date,
                }
            )
            validate_group_budget_for_args(args)


def validate_group_budget_for_gl_entry(doc, _method=None) -> None:
    if doc.voucher_type == "Period Closing Voucher":
        return
    if doc.is_cancelled and doc.voucher_type != "Journal Entry":
        return
    expense_amount = flt(doc.debit) - flt(doc.credit)
    if expense_amount <= 0:
        return
    validate_group_budget_for_args(frappe._dict(doc.as_dict()), expense_amount=0)


def validate_group_budget_for_args(args, expense_amount: float = 0) -> None:
    args = frappe._dict(args)
    if not args.get("fiscal_year"):
        args.fiscal_year = get_fiscal_year(args.get("posting_date"), company=args.get("company"))[0]

    if args.get("company"):
        frappe.flags.exception_approver_role = frappe.get_cached_value(
            "Company", args.company, "exception_budget_approver_role"
        )

    if not args.get("account"):
        args.account = args.get("expense_account")

    if not (args.get("account") and args.get("cost_center")) and args.get("item_code"):
        args.cost_center, args.account = get_item_details(args)

    if not args.get("account"):
        return

    account_details = get_account_details(args.account)
    if account_details.root_type != EXPENSE_ROOT_TYPE:
        return

    for dimension in _budget_dimensions():
        budget_against_field = dimension.get("fieldname")
        target_name = args.get(budget_against_field)
        if not target_name:
            continue

        scope_args = frappe._dict(args.copy())
        scope_args.budget_against_field = budget_against_field
        scope_args.budget_against_doctype = dimension.get("document_type")
        scope_args.is_tree = bool(frappe.get_cached_value("DocType", scope_args.budget_against_doctype, "is_tree"))

        budget_rows = _find_nearest_budget_rows(scope_args)
        if budget_rows:
            _validate_budget_rows(scope_args, budget_rows, expense_amount)


def _validate_budget_rows(args, budget_rows: list[BudgetAccountRow], expense_amount: float) -> None:
    for budget_row in budget_rows:
        if not flt(budget_row.budget_amount):
            continue
        yearly_action, monthly_action = _get_actions(args, budget_row.budget_doc)
        args.for_material_request = budget_row.budget_doc.applicable_on_material_request
        args.for_purchase_order = budget_row.budget_doc.applicable_on_purchase_order
        args.budget_account = budget_row.account

        if yearly_action in ("Stop", "Warn"):
            _compare_expense_with_budget(
                args,
                flt(budget_row.budget_amount),
                _("Annual"),
                yearly_action,
                budget_row.budget_against_value,
                expense_amount,
            )

        if monthly_action in ("Stop", "Warn"):
            budget_amount = get_accumulated_monthly_budget(
                budget_row.monthly_distribution,
                args.posting_date,
                args.fiscal_year,
                budget_row.budget_amount,
            )
            args.month_end_date = get_last_day(args.posting_date)
            _compare_expense_with_budget(
                args,
                budget_amount,
                _("Accumulated Monthly"),
                monthly_action,
                budget_row.budget_against_value,
                expense_amount,
            )


def _compare_expense_with_budget(args, budget_amount, action_for, action, budget_against, amount=0) -> None:
    args.actual_expense = _get_actual_expense(args)
    args.requested_amount = 0
    args.ordered_amount = 0

    if not amount:
        args.requested_amount = _get_requested_amount(args)
        args.ordered_amount = _get_ordered_amount(args)

        if args.get("doctype") == "Material Request" and args.for_material_request:
            amount = args.requested_amount + args.ordered_amount
        elif args.get("doctype") == "Purchase Order" and args.for_purchase_order:
            amount = args.ordered_amount

    total_expense = args.actual_expense + amount
    if total_expense <= budget_amount:
        return

    if args.actual_expense > budget_amount:
        error_tense = _("is already")
        diff = args.actual_expense - budget_amount
    else:
        error_tense = _("will be")
        diff = total_expense - budget_amount

    currency = frappe.get_cached_value("Company", args.company, "default_currency")
    msg = _("{0} Budget for Account {1} against {2} {3} is {4}. It {5} exceed by {6}").format(
        _(action_for),
        frappe.bold(args.budget_account),
        frappe.unscrub(args.budget_against_field),
        frappe.bold(budget_against),
        frappe.bold(fmt_money(budget_amount, currency=currency)),
        error_tense,
        frappe.bold(fmt_money(diff, currency=currency)),
    )
    if args.budget_account != args.account:
        msg += "<br>" + _("Transaction account: {0}").format(frappe.bold(args.account))

    if frappe.flags.exception_approver_role and frappe.flags.exception_approver_role in frappe.get_roles(
        frappe.session.user
    ):
        action = "Warn"

    if action == "Stop":
        frappe.throw(msg, BudgetError, title=_("Budget Exceeded"))
    frappe.msgprint(msg, indicator="orange", title=_("Budget Exceeded"))


def _get_actions(args, budget) -> tuple[str, str]:
    yearly_action = budget.action_if_annual_budget_exceeded
    monthly_action = budget.action_if_accumulated_monthly_budget_exceeded

    if args.get("doctype") == "Material Request" and budget.applicable_on_material_request:
        yearly_action = budget.action_if_annual_budget_exceeded_on_mr
        monthly_action = budget.action_if_accumulated_monthly_budget_exceeded_on_mr
    elif args.get("doctype") == "Purchase Order" and budget.applicable_on_purchase_order:
        yearly_action = budget.action_if_annual_budget_exceeded_on_po
        monthly_action = budget.action_if_accumulated_monthly_budget_exceeded_on_po

    return yearly_action, monthly_action


def _find_nearest_budget_rows(args) -> list[BudgetAccountRow]:
    scope = BudgetScope(
        company=args.company,
        fiscal_year=args.fiscal_year,
        budget_against=args.budget_against_doctype,
        budget_against_field=args.budget_against_field,
        target_name=args.get(args.budget_against_field),
    )
    rows = _get_budget_account_rows_for_scope(scope, include_drafts=False)
    matching_rows = [row for row in rows if is_account_in_subtree(args.account, row.account)]
    if not matching_rows:
        return []

    details = {row.account: get_account_details(row.account) for row in matching_rows}
    nearest_lft = max(details[row.account].lft for row in matching_rows)
    nearest = [row for row in matching_rows if details[row.account].lft == nearest_lft]

    if args.get("doctype") == "Material Request":
        return [row for row in nearest if row.budget_doc.applicable_on_material_request]
    if args.get("doctype") == "Purchase Order":
        return [row for row in nearest if row.budget_doc.applicable_on_purchase_order]
    return [row for row in nearest if row.budget_doc.applicable_on_booking_actual_expenses]


def _get_budget_account_rows_for_scope(
    scope: BudgetScope,
    current_doc=None,
    include_drafts: bool = False,
) -> list[BudgetAccountRow]:
    filters = {
        "company": scope.company,
        "fiscal_year": scope.fiscal_year,
        "budget_against": scope.budget_against,
        scope.budget_against_field: scope.target_name,
    }
    if include_drafts:
        filters["docstatus"] = ["<", 2]
    else:
        filters["docstatus"] = 1

    rows = []
    for budget_ref in frappe.get_all("Budget", filters=filters, fields=["name"]):
        if current_doc and budget_ref.name == current_doc.name:
            continue
        budget = frappe.get_doc("Budget", budget_ref.name)
        if _is_cancelled_draft(budget):
            continue
        rows.extend(_budget_account_rows(budget, scope))

    if current_doc:
        rows.extend(_budget_account_rows(current_doc, scope))

    return rows


def _budget_account_rows(doc, scope: BudgetScope) -> list[BudgetAccountRow]:
    return [
        BudgetAccountRow(
            budget_name=doc.name,
            account=row.account,
            budget_amount=flt(row.budget_amount),
            monthly_distribution=doc.monthly_distribution,
            budget_against_value=doc.get(scope.budget_against_field),
            budget_doc=doc,
        )
        for row in doc.get("accounts") or []
        if row.account
    ]


def _is_cancelled_draft(budget) -> bool:
    return budget.docstatus == 0 and getattr(budget, BUDGET_WORKFLOW_STATE_FIELD, None) == STATE_CANCELLED_DRAFT


def _is_descendant(child_details, parent_details) -> bool:
    return (
        child_details.company == parent_details.company
        and child_details.lft > parent_details.lft
        and child_details.rgt < parent_details.rgt
    )


def _has_budgeted_account_between(parent_details, child_details, rows, account_details) -> bool:
    for row in rows:
        details = account_details[row.account]
        if details.name in {parent_details.name, child_details.name}:
            continue
        if _is_descendant(details, parent_details) and (
            child_details.lft >= details.lft and child_details.rgt <= details.rgt
        ):
            return True
    return False


def _budget_dimensions() -> list[dict]:
    return [
        {"fieldname": "project", "document_type": "Project"},
        {"fieldname": "cost_center", "document_type": "Cost Center"},
    ] + get_accounting_dimensions(as_list=False)


def _get_actual_expense(args) -> float:
    filters = {
        "is_cancelled": 0,
        "account": ["in", get_descendant_account_names(args.budget_account)],
        "fiscal_year": args.fiscal_year,
        "company": args.company,
        "docstatus": 1,
    }
    if args.get("month_end_date"):
        filters["posting_date"] = ["<=", args.month_end_date]
    filters[args.budget_against_field] = [
        "in",
        get_dimension_descendant_names(args.budget_against_doctype, args.get(args.budget_against_field)),
    ]
    rows = frappe.get_all("GL Entry", filters=filters, fields=["debit", "credit"])
    return sum(flt(row.debit) - flt(row.credit) for row in rows)


def _get_requested_amount(args) -> float:
    if not args.get("item_code"):
        return 0.0
    fields = [
        "parent",
        "stock_qty",
        "ordered_qty",
        "rate",
    ] + _doctype_existing_fields("Material Request Item", [args.budget_against_field])
    rows = frappe.get_all(
        "Material Request Item",
        filters={
            "item_code": args.item_code,
            "expense_account": ["in", get_descendant_account_names(args.budget_account)],
        },
        fields=fields,
    )
    return sum(
        (flt(row.stock_qty) - flt(row.ordered_qty)) * flt(row.rate)
        for row in rows
        if flt(row.stock_qty) > flt(row.ordered_qty)
        and _row_matches_parent_doc(row.parent, "Material Request", args, "schedule_date")
        and _dimension_value_matches(row.get(args.budget_against_field), args)
    )


def _get_ordered_amount(args) -> float:
    if not args.get("item_code"):
        return 0.0
    fields = [
        "parent",
        "amount",
        "billed_amt",
    ] + _doctype_existing_fields("Purchase Order Item", [args.budget_against_field])
    rows = frappe.get_all(
        "Purchase Order Item",
        filters={
            "item_code": args.item_code,
            "expense_account": ["in", get_descendant_account_names(args.budget_account)],
        },
        fields=fields,
    )
    return sum(
        flt(row.amount) - flt(row.billed_amt)
        for row in rows
        if flt(row.amount) > flt(row.billed_amt)
        and _row_matches_parent_doc(row.parent, "Purchase Order", args, "transaction_date")
        and _dimension_value_matches(row.get(args.budget_against_field), args)
    )


def _row_matches_parent_doc(parent_name: str, doctype: str, args, date_field: str) -> bool:
    fields = ["docstatus", "status", date_field]
    if doctype == "Material Request":
        fields.append("material_request_type")
    parent = frappe.db.get_value(doctype, parent_name, fields, as_dict=True)
    if not parent or parent.docstatus != 1:
        return False
    if doctype == "Material Request":
        if parent.material_request_type != "Purchase" or parent.status == "Stopped":
            return False
    elif parent.status == "Closed":
        return False
    start_date, end_date = frappe.get_cached_value(
        "Fiscal Year", args.fiscal_year, ["year_start_date", "year_end_date"]
    )
    return getdate(start_date) <= getdate(parent.get(date_field)) <= getdate(end_date)


def _dimension_value_matches(value: str | None, args) -> bool:
    if args.budget_against_field not in _doctype_existing_fields(
        "Material Request Item" if args.get("doctype") == "Material Request" else "Purchase Order Item",
        [args.budget_against_field],
    ):
        return True
    if not value:
        return False
    return value in get_dimension_descendant_names(
        args.budget_against_doctype,
        args.get(args.budget_against_field),
    )


def _doctype_existing_fields(doctype: str, fieldnames: list[str]) -> list[str]:
    meta = frappe.get_meta(doctype)
    return [fieldname for fieldname in fieldnames if meta.has_field(fieldname)]
