"""Services for Budget approval flow driven from project P&L."""

from __future__ import annotations

import json
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

import frappe
from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
    get_accounting_dimensions,
)
from erpnext.accounts.doctype.budget.budget import DuplicateBudgetError
from erpnext.accounts.utils import get_fiscal_year
from frappe import _
from frappe.model.workflow import apply_workflow
from frappe.utils import getdate

from dinext_projects_pl.dinext_projects_pl.budget_approval.bootstrap import (
    ACTION_CANCEL,
    ACTION_SUBMIT_FOR_APPROVAL,
    BUDGET_ACCOUNT_FIELD,
    BUDGET_MONTHLY_AMOUNTS_FIELD,
    BUDGET_WORKFLOW_STATE_FIELD,
    STATE_APPROVED,
    STATE_CANCELLED_APPROVED,
    STATE_CANCELLED_DRAFT,
    STATE_PENDING_APPROVAL,
)

PROJECT_BUDGET_DOCTYPE = "Project Budget"
RISK_DIMENSION = "Project Risk"
TASK_DIMENSION = "Task"
AMOUNT_QUANTIZE = Decimal("0.01")


@frappe.whitelist()
def save_budget_plan_for_approval(project: str, data) -> dict:
    """Create approval Budgets for selected P&L plan rows."""
    rows = _parse_json_if_needed(data)
    if not project:
        frappe.throw(_("Project is required"))
    if not rows:
        frappe.throw(_("No plan rows selected for approval"))

    project_doc = frappe.get_doc("Project", project)
    grouped = _group_plan_rows(project_doc.company, rows)
    created = []
    cancelled_pending = 0

    for entry in grouped.values():
        entry["project"] = project_doc.name
        entry["company"] = project_doc.company
        cancelled_pending += _cancel_pending_budgets(entry)
    if cancelled_pending:
        frappe.db.commit()

    for entry in grouped.values():
        try:
            budget = _create_budget_from_entry(project_doc, entry)
        except DuplicateBudgetError:
            _force_cancel_conflicting_draft_budgets(entry)
            frappe.db.commit()
            budget = _create_budget_from_entry(project_doc, entry)
        budget = apply_workflow(budget, ACTION_SUBMIT_FOR_APPROVAL)
        created.append(
            {
                "budget": budget.name,
                "monthly_distribution": budget.monthly_distribution,
                "fiscal_year": entry["fiscal_year"],
            }
        )

    frappe.db.commit()
    return {
        "budgets": created,
        "created_count": len(created),
        "cancelled_pending_count": cancelled_pending,
    }


def on_budget_submit(doc, _method=None):
    """Sync approved Budget into Project Budget and cancel previous approved version."""
    if not _is_budget_approval_doc(doc):
        return

    _cancel_previous_approved_budgets(doc)
    _sync_budget_to_project_budget(doc)


def on_budget_cancel(doc, _method=None):
    """Handle Budget cancellation semantics for Project Budget read model."""
    if not _is_budget_approval_doc(doc):
        return

    if doc.workflow_state != STATE_CANCELLED_APPROVED:
        return

    replacement = _find_matching_budgets(
        _budget_identity(doc),
        include_submitted_only=True,
        exclude_names={doc.name},
    )
    if replacement:
        _sync_budget_to_project_budget(replacement[0])
    else:
        _clear_budget_from_project_budget(doc)


@frappe.whitelist()
def find_approved_budget_for_period(project: str, account: str, year: int, month: int, dimensions=None):
    """Return approved Budget name matching the canonical key for a plan cell."""
    if not project or not account or not year or not month:
        return None

    dimensions = _parse_json_if_needed(dimensions)
    normalized_dimensions = _normalize_dimensions(dimensions or [])
    fiscal_year = get_fiscal_year(getdate(f"{int(year)}-{int(month):02d}-01"), company=frappe.db.get_value("Project", project, "company"))[0]
    target = _resolve_target(normalized_dimensions)
    identity = {
        "company": frappe.db.get_value("Project", project, "company"),
        "project": project,
        "account": account,
        "budget_against": target["budget_against"],
        "target_name": target["target_name"],
        "fiscal_year": fiscal_year,
        "dimensions": normalized_dimensions,
    }
    matches = _find_matching_budgets(identity, include_submitted_only=True)
    approved = [budget for budget in matches if budget.workflow_state == STATE_APPROVED]
    return approved[0].name if approved else None


def _parse_json_if_needed(value):
    if isinstance(value, str):
        return json.loads(value)
    return value or []


def _group_plan_rows(company: str, rows: list[dict]) -> dict:
    grouped: dict[tuple, dict] = {}
    risk_buffers: dict[tuple, dict[tuple[int, int], float]] = defaultdict(lambda: defaultdict(float))

    for row in rows:
        account = (row.get("account") or "").strip()
        dimensions = _normalize_dimensions(row.get("dimensions") or [])
        amounts = row.get("amounts") or []
        if not account or not amounts:
            continue

        base_dimensions = [d for d in dimensions if d["doc"] != RISK_DIMENSION]
        has_risk = any(d["doc"] == RISK_DIMENSION for d in dimensions)

        for amount in amounts:
            year = int(amount.get("year"))
            month = int(amount.get("month"))
            plan_value = float(amount.get("plan_value") or 0)
            if plan_value <= 0:
                continue

            fiscal_year = get_fiscal_year(
                getdate(f"{year}-{month:02d}-01"),
                company=company,
            )[0]
            target = _resolve_target(base_dimensions)
            key = (account, target["budget_against"], target["target_name"], fiscal_year, _dimensions_key(base_dimensions))
            period_key = (year, month)

            if has_risk:
                risk_buffers[key][period_key] += plan_value
                continue

            entry = grouped.setdefault(
                key,
                {
                    "account": account,
                    "dimensions": base_dimensions,
                    "target": target,
                    "fiscal_year": fiscal_year,
                    "company": company,
                    "period_amounts": defaultdict(float),
                },
            )
            entry["period_amounts"][period_key] += plan_value

    for key, risk_amounts in risk_buffers.items():
        entry = grouped.setdefault(
            key,
            {
                "account": key[0],
                "dimensions": _dimensions_from_key(key[4]),
                "target": {
                    "budget_against": key[1],
                    "target_name": key[2],
                },
                "fiscal_year": key[3],
                    "company": company,
                "period_amounts": defaultdict(float),
            },
        )
        for period_key, value in risk_amounts.items():
            entry["period_amounts"][period_key] += value

    return grouped


def _resolve_target(dimensions: list[dict]) -> dict:
    task_dimension = next((d for d in dimensions if d["doc"] == TASK_DIMENSION), None)
    if task_dimension:
        return {"budget_against": TASK_DIMENSION, "target_name": task_dimension["docname"]}
    return {"budget_against": "Project", "target_name": None}


def _normalize_dimensions(dimensions: list[dict]) -> list[dict]:
    normalized = []
    for dimension in dimensions:
        doc = (dimension.get("doc") or "").strip()
        docname = (dimension.get("docname") or "").strip()
        if not doc or not docname:
            continue
        normalized.append({"doc": doc, "docname": docname})
    normalized.sort(key=lambda d: f"{d['doc']}:{d['docname']}")
    return normalized


def _dimensions_key(dimensions: list[dict]) -> str:
    return "|".join(f"{d['doc']}:{d['docname']}" for d in dimensions)


def _dimensions_from_key(dimensions_key: str) -> list[dict]:
    if not dimensions_key:
        return []
    dimensions = []
    for part in dimensions_key.split("|"):
        doc, docname = part.split(":", 1)
        dimensions.append({"doc": doc, "docname": docname})
    return dimensions


def _cancel_pending_budgets(entry: dict) -> int:
    count = 0
    for budget in _find_matching_budgets(entry, include_submitted_only=False):
        if budget.docstatus == 0 and budget.workflow_state in {STATE_PENDING_APPROVAL, "Draft"}:
            apply_workflow(budget, ACTION_CANCEL)
            count += 1
    return count


def _force_cancel_conflicting_draft_budgets(entry: dict) -> None:
    for budget in _find_matching_budgets(entry, include_submitted_only=False):
        if budget.docstatus != 0:
            continue
        if budget.workflow_state not in {STATE_PENDING_APPROVAL, "Draft"}:
            continue
        apply_workflow(budget, ACTION_CANCEL)
    for budget in _find_conflicting_draft_budgets(entry):
        if budget.workflow_state not in {STATE_PENDING_APPROVAL, "Draft"}:
            continue
        apply_workflow(budget, ACTION_CANCEL)


def _find_conflicting_draft_budgets(entry: dict):
    filters = {
        "company": entry["company"],
        "fiscal_year": entry["fiscal_year"],
        "budget_against": entry["target"]["budget_against"],
        "project": entry["project"],
        "docstatus": 0,
    }
    if entry["target"]["budget_against"] == TASK_DIMENSION:
        filters["task"] = entry["target"]["target_name"]

    rows = frappe.get_all("Budget", filters=filters, fields=["name"])
    conflicts = []
    for row in rows:
        budget = frappe.get_doc("Budget", row.name)
        if budget.accounts[0].account == entry["account"]:
            conflicts.append(budget)
    return conflicts


def _find_matching_budgets(entry_or_identity: dict, include_submitted_only: bool, exclude_names: set[str] | None = None):
    identity = entry_or_identity if "budget_against" in entry_or_identity else entry_or_identity["target"] | {
        "account": entry_or_identity["account"],
        "dimensions": entry_or_identity["dimensions"],
        "fiscal_year": entry_or_identity["fiscal_year"],
        "project": entry_or_identity.get("project"),
    }
    exclude_names = exclude_names or set()

    filters = {
        "company": identity["company"] if "company" in identity else frappe.db.get_single_value("Global Defaults", "default_company"),
        "fiscal_year": identity["fiscal_year"],
    }
    budget_against = identity["budget_against"]
    target_name = identity["target_name"]
    filters["budget_against"] = budget_against
    if budget_against == "Project":
        filters["project"] = identity["project"]
    else:
        filters[frappe.scrub(budget_against)] = target_name
        filters["project"] = identity["project"]
    if include_submitted_only:
        filters["docstatus"] = 1
    else:
        filters["docstatus"] = ["<", 2]

    rows = frappe.get_all("Budget", filters=filters, fields=["name"])
    matches = []
    for row in rows:
        if row.name in exclude_names:
            continue
        budget = frappe.get_doc("Budget", row.name)
        if budget.accounts[0].account != identity["account"]:
            continue
        if _budget_dimensions(budget) != _normalize_dimensions(identity.get("dimensions") or []):
            continue
        matches.append(budget)
    return matches


def _create_budget_from_entry(project_doc, entry: dict):
    annual_amount = sum(entry["period_amounts"].values())
    budget = frappe.new_doc("Budget")
    budget.company = project_doc.company
    budget.fiscal_year = entry["fiscal_year"]
    budget.budget_against = entry["target"]["budget_against"]
    budget.project = project_doc.name
    budget.set(BUDGET_ACCOUNT_FIELD, entry["account"])
    budget.set(
        BUDGET_MONTHLY_AMOUNTS_FIELD,
        _serialize_period_amounts(entry["period_amounts"]),
    )
    if entry["target"]["budget_against"] == TASK_DIMENSION:
        budget.task = entry["target"]["target_name"]

    for dimension in entry["dimensions"]:
        fieldname = frappe.scrub(dimension["doc"])
        if fieldname in {"project", "cost_center"}:
            continue
        if not budget.meta.get_field(fieldname):
            continue
        budget.set(fieldname, dimension["docname"])

    budget.monthly_distribution = _create_monthly_distribution(
        project_doc.name,
        entry["account"],
        entry["target"],
        entry["fiscal_year"],
        entry["period_amounts"],
    ).name
    budget.append(
        "accounts",
        {
            "account": entry["account"],
            "budget_amount": annual_amount,
        },
    )
    budget.insert(ignore_permissions=True)
    return budget


def _create_monthly_distribution(project: str, account: str, target: dict, fiscal_year: str, period_amounts: dict):
    distribution_id = (
        f"BDG-{project}-{account}-{target['budget_against']}-{target['target_name'] or project}-{fiscal_year}-{frappe.generate_hash(length=6)}"
    )[:140]

    distribution = frappe.new_doc("Monthly Distribution")
    distribution.distribution_id = distribution_id
    distribution.fiscal_year = fiscal_year

    annual_amount = sum(period_amounts.values())
    month_map = defaultdict(float)
    for (_year, month), amount in period_amounts.items():
        month_map[month] += amount

    month_names = {
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
    percentages = {}
    running_total = Decimal("0")
    last_nonzero_month = max(month_map, default=12)
    for month in range(1, 13):
        if annual_amount <= 0 or month_map.get(month, 0) <= 0:
            percentage = Decimal("0")
        elif month == last_nonzero_month:
            percentage = Decimal("100") - running_total
        else:
            percentage = (
                Decimal(str(month_map[month])) / Decimal(str(annual_amount)) * Decimal("100")
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        percentages[month] = percentage
        running_total += percentage

    for month in range(1, 13):
        distribution.append(
            "percentages",
            {
                "month": month_names[month],
                "percentage_allocation": float(percentages[month]),
            },
        )

    distribution.insert(ignore_permissions=True)
    return distribution


def _cancel_previous_approved_budgets(doc):
    identity = _budget_identity(doc)
    matches = _find_matching_budgets(identity, include_submitted_only=True, exclude_names={doc.name})
    for budget in matches:
        if budget.workflow_state != STATE_APPROVED:
            continue
        apply_workflow(budget, ACTION_CANCEL)


def _sync_budget_to_project_budget(doc):
    identity = _budget_identity(doc)
    dimensions = _budget_dimensions(doc)
    project_budget = _get_or_create_project_budget(identity["project"], identity["account"], dimensions)
    amounts_map = {
        (row.pba_year, row.pba_month): row
        for row in (project_budget.get("project_budget_amount") or [])
        if row.pba_year and row.pba_month
    }

    monthly_values = _get_budget_source_monthly_amounts(doc)
    for (year, month), plan_value in monthly_values.items():
        amount_row = amounts_map.get((year, month))
        if not amount_row:
            amount_row = project_budget.append(
                "project_budget_amount",
                {
                    "pba_year": year,
                    "pba_month": month,
                },
            )
            amounts_map[(year, month)] = amount_row
        amount_row.pba_plan = plan_value

    project_budget.save(ignore_permissions=True)


def _clear_budget_from_project_budget(doc):
    identity = _budget_identity(doc)
    dimensions = _budget_dimensions(doc)
    existing_name = _find_project_budget(identity["project"], identity["account"], dimensions)
    if not existing_name:
        return
    project_budget = frappe.get_doc(PROJECT_BUDGET_DOCTYPE, existing_name)
    monthly_values = _get_budget_source_monthly_amounts(doc)
    for row in project_budget.get("project_budget_amount") or []:
        if (row.pba_year, row.pba_month) in monthly_values:
            row.pba_plan = 0
    project_budget.save(ignore_permissions=True)


def _get_budget_source_monthly_amounts(doc) -> dict[tuple[int, int], float]:
    exact_amounts = doc.get(BUDGET_MONTHLY_AMOUNTS_FIELD)
    if exact_amounts:
        return _deserialize_period_amounts(exact_amounts)
    return _monthly_values_from_budget(doc)


def _serialize_period_amounts(period_amounts: dict) -> dict[str, str]:
    serialized = {}
    for (year, month), amount in sorted(period_amounts.items()):
        serialized[f"{int(year)}-{int(month):02d}"] = str(_to_decimal_amount(amount))
    return serialized


def _deserialize_period_amounts(period_amounts) -> dict[tuple[int, int], float]:
    if isinstance(period_amounts, str):
        period_amounts = json.loads(period_amounts)

    result = {}
    for period_key, amount in (period_amounts or {}).items():
        year_str, month_str = period_key.split("-", 1)
        result[(int(year_str), int(month_str))] = float(_to_decimal_amount(amount))
    return result


def _to_decimal_amount(amount) -> Decimal:
    return Decimal(str(amount or 0)).quantize(AMOUNT_QUANTIZE, rounding=ROUND_HALF_UP)


def _monthly_values_from_budget(doc) -> dict[tuple[int, int], float]:
    monthly_distribution = frappe.get_doc("Monthly Distribution", doc.monthly_distribution)
    annual_amount = float(doc.accounts[0].budget_amount)
    month_percentages = {row.month: float(row.percentage_allocation or 0) for row in monthly_distribution.percentages}
    months = {
        "January": 1,
        "February": 2,
        "March": 3,
        "April": 4,
        "May": 5,
        "June": 6,
        "July": 7,
        "August": 8,
        "September": 9,
        "October": 10,
        "November": 11,
        "December": 12,
    }
    fiscal_year_doc = frappe.get_doc("Fiscal Year", doc.fiscal_year)
    fiscal_year_start = getdate(fiscal_year_doc.year_start_date)
    month_to_period = {}
    for offset in range(12):
        period_date = frappe.utils.add_months(fiscal_year_start, offset)
        month_to_period[period_date.strftime("%B")] = (period_date.year, period_date.month)

    monthly_values = {}
    running_total = Decimal("0")
    nonzero_months = [month for month, value in month_percentages.items() if value > 0]
    last_nonzero_month_name = nonzero_months[-1] if nonzero_months else None
    for month_name, month in months.items():
        period_year, period_month = month_to_period.get(month_name, (fiscal_year_start.year, month))
        percentage = Decimal(str(month_percentages.get(month_name, 0)))
        if percentage <= 0:
            value = Decimal("0")
        elif month_name == last_nonzero_month_name:
            value = Decimal(str(annual_amount)) - running_total
        else:
            value = (
                Decimal(str(annual_amount)) * percentage / Decimal("100")
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        running_total += value
        if value > 0:
            monthly_values[(period_year, period_month)] = float(value)
    return monthly_values


def _budget_identity(doc) -> dict:
    dimensions = _budget_dimensions(doc)
    target_name = doc.project
    if doc.budget_against == TASK_DIMENSION:
        target_name = doc.task
    return {
        "company": doc.company,
        "project": doc.project,
        "account": doc.accounts[0].account,
        "budget_against": doc.budget_against,
        "target_name": target_name,
        "fiscal_year": doc.fiscal_year,
        "dimensions": dimensions,
    }


def _budget_dimensions(doc) -> list[dict]:
    dimensions = []
    for dimension in get_accounting_dimensions(as_list=False):
        fieldname = dimension["fieldname"]
        value = doc.get(fieldname)
        if not value:
            continue
        dimensions.append({"doc": dimension["document_type"], "docname": value})

    if doc.budget_against == "Project":
        return _normalize_dimensions([d for d in dimensions if d["doc"] != "Project"])
    return _normalize_dimensions(dimensions)


def _is_budget_approval_doc(doc) -> bool:
    return bool(getattr(doc, BUDGET_WORKFLOW_STATE_FIELD, None))


def _find_project_budget(project: str, account: str, dimensions: list[dict]) -> str | None:
    target_key = _dimensions_key(_normalize_dimensions(dimensions))
    for row in frappe.get_all(
        PROJECT_BUDGET_DOCTYPE,
        filters={"pb_project": project, "pb_account": account},
        fields=["name"],
    ):
        doc = frappe.get_doc(PROJECT_BUDGET_DOCTYPE, row.name)
        current_key = _dimensions_key(
            _normalize_dimensions(
                [{"doc": dim.doc, "docname": dim.docname} for dim in (doc.project_budget_dimension or [])]
            )
        )
        if current_key == target_key:
            return doc.name
    return None


def _get_or_create_project_budget(project: str, account: str, dimensions: list[dict]):
    existing_name = _find_project_budget(project, account, dimensions)
    if existing_name:
        return frappe.get_doc(PROJECT_BUDGET_DOCTYPE, existing_name)

    project_budget = frappe.new_doc(PROJECT_BUDGET_DOCTYPE)
    project_budget.pb_project = project
    project_budget.pb_account = account
    for dimension in _normalize_dimensions(dimensions):
        project_budget.append("project_budget_dimension", dimension)
    return project_budget
