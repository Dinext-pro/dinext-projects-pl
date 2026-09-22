# Copyright (c) 2025, Dinord and contributors
"""Frappe Query Builder helpers for project budget plan vs forecast report."""

import frappe
from frappe.query_builder import Case
from frappe.query_builder.functions import Coalesce, Round, Sum
from frappe.utils import cint, cstr, getdate
from pypika import Order
from pypika.terms import ExistsCriterion, Function

from .filter_utils import RISK_DIMENSION, get_company_names
from .risk_utils import DATA_TYPE_WITH_RISK, DATA_TYPE_WITHOUT_TASK, DATA_TYPE_WITH_TASK


def _year(field):
	return Function("YEAR", field)


def _month(field):
	return Function("MONTH", field)


# ---------------------------------------------------------------------------
# Shared filter helpers (qb)
# ---------------------------------------------------------------------------


def apply_company_filter(query, column, filters):
	companies = get_company_names(filters)
	if not companies:
		return query
	if len(companies) == 1:
		return query.where(column == companies[0])
	return query.where(column.isin(companies))


def apply_dimension_filter(query, filters, field, column):
	value = filters.get(field)
	if not value:
		return query
	if isinstance(value, (list, tuple)):
		if len(value) == 1:
			return query.where(column == value[0])
		return query.where(column.isin(value))
	return query.where(column == value)


def apply_finance_book_filter(query, column, filters):
	companies = get_company_names(filters)
	finance_books = []
	for company in companies:
		fb = frappe.get_cached_value("Company", company, "default_finance_book")
		if fb and cstr(fb) not in finance_books:
			finance_books.append(cstr(fb))

	if len(finance_books) == 1:
		fb = finance_books[0]
		return query.where((column == fb) | (column == "") | column.isnull())
	if finance_books:
		return query.where(column.isin(finance_books + [""]) | column.isnull())
	return query.where((column == "") | column.isnull())


def apply_portfolio_filter(query, project_column, filters):
	portfolio = filters.get("project_portfolio")
	if not portfolio or filters.get("project"):
		return query

	Project = frappe.qb.DocType("Project")
	if isinstance(portfolio, (list, tuple)):
		exists = ExistsCriterion(
			frappe.qb.from_(Project)
			.select(1)
			.where(
				(Project.name == project_column)
				& (Project.custom_project_portfolio.isin(list(portfolio)))
			)
		)
	else:
		exists = ExistsCriterion(
			frappe.qb.from_(Project)
			.select(1)
			.where(
				(Project.name == project_column)
				& (Project.custom_project_portfolio == portfolio)
			)
		)
	return query.where(exists)


def apply_writable_projects_filter(query, column, filters):
	if filters.get("project"):
		return query

	writable = filters.get("_report_writable_projects")
	if writable is None:
		from .permissions import get_writable_report_projects

		writable = get_writable_report_projects(filters)
		filters["_report_writable_projects"] = writable

	if not writable:
		return query.where(column.isin(["__no_writable_project__"]))
	return query.where(column.isin(writable))


def apply_optional_name_filter(query, column, names):
	"""None = no name filter (report default). Empty = match nothing."""
	if names is None:
		return query
	if not names:
		return query.where(column.isin(["__no_readable_doc__"]))
	return query.where(column.isin(list(names)))


def _period_match_criterion(pba, month_periods):
	criterion = None
	for period_year, period_month in month_periods:
		cond = (pba.pba_year == cint(period_year)) & (pba.pba_month == cint(period_month))
		criterion = cond if criterion is None else criterion | cond
	return criterion


# ---------------------------------------------------------------------------
# Account / CoA
# ---------------------------------------------------------------------------


def fetch_active_pl_accounts(companies):
	if not companies:
		return []
	company_filter = companies[0] if len(companies) == 1 else ["in", companies]
	return frappe.db.get_all(
		"Account",
		filters={
			"company": company_filter,
			"disabled": 0,
			"root_type": ["in", ["Income", "Expense"]],
		},
		fields=[
			"name",
			"account_name",
			"parent_account",
			"is_group",
			"root_type",
			"lft",
			"rgt",
		],
		order_by="lft",
	)


def fetch_account_subtree_names(account, company):
	lft, rgt = frappe.db.get_value("Account", account, ["lft", "rgt"]) or (None, None)
	if lft is None or rgt is None:
		return []
	return frappe.db.get_all(
		"Account",
		filters={
			"company": company,
			"lft": [">=", lft],
			"rgt": ["<=", rgt],
		},
		pluck="name",
	)


# ---------------------------------------------------------------------------
# Budget / allocation history
# ---------------------------------------------------------------------------


def allocation_history_queries(projects):
	"""Return (cost_center_query, business_area_query) for project allocation prefetch."""
	CostCenterTable = frappe.qb.DocType("Cost Center Table")
	CostBusinessArea = frappe.qb.DocType("Cost Business Area")

	cc_query = (
		frappe.qb.from_(CostCenterTable)
		.select(
			CostCenterTable.parent.as_("project"),
			CostCenterTable.cct_cost_center.as_("cost_center"),
			CostCenterTable.cct_valid_from.as_("valid_from"),
		)
		.where(CostCenterTable.parent.isin(projects))
		.orderby(CostCenterTable.parent)
		.orderby(CostCenterTable.cct_valid_from, order=Order.desc)
	)

	ba_query = (
		frappe.qb.from_(CostBusinessArea)
		.select(
			CostBusinessArea.parent.as_("project"),
			CostBusinessArea.business_area,
			CostBusinessArea.percent,
			CostBusinessArea.valid_from,
		)
		.where(CostBusinessArea.parent.isin(projects))
		.orderby(CostBusinessArea.parent)
		.orderby(CostBusinessArea.valid_from, order=Order.desc)
		.orderby(CostBusinessArea.creation, order=Order.desc)
	)

	return cc_query, ba_query


def build_cost_center_history_query(project, as_of_date=None):
	CostCenterTable = frappe.qb.DocType("Cost Center Table")
	query = (
		frappe.qb.from_(CostCenterTable)
		.select(
			CostCenterTable.cct_cost_center.as_("cost_center"),
			CostCenterTable.cct_valid_from.as_("valid_from"),
		)
		.where(CostCenterTable.parent == project)
		.orderby(CostCenterTable.cct_valid_from, order=Order.desc)
	)
	if as_of_date is not None:
		query = query.where(CostCenterTable.cct_valid_from <= getdate(as_of_date))
	return query


def build_business_area_history_query(project, as_of_date=None):
	CostBusinessArea = frappe.qb.DocType("Cost Business Area")
	query = (
		frappe.qb.from_(CostBusinessArea)
		.select(
			CostBusinessArea.business_area,
			CostBusinessArea.percent,
			CostBusinessArea.valid_from,
		)
		.where(CostBusinessArea.parent == project)
		.orderby(CostBusinessArea.valid_from, order=Order.desc)
		.orderby(CostBusinessArea.creation, order=Order.desc)
	)
	if as_of_date is not None:
		query = query.where(CostBusinessArea.valid_from <= getdate(as_of_date))
	return query


def build_cost_center_allocation_query(main_cost_center, target_date):
	CostCenterAllocation = frappe.qb.DocType("Cost Center Allocation")
	return (
		frappe.qb.from_(CostCenterAllocation)
		.select(CostCenterAllocation.name, CostCenterAllocation.valid_from)
		.where(CostCenterAllocation.main_cost_center == main_cost_center)
		.where(CostCenterAllocation.docstatus == 1)
		.where(CostCenterAllocation.valid_from <= getdate(target_date))
		.orderby(CostCenterAllocation.valid_from, order=Order.desc)
		.limit(1)
	)


def build_cost_center_allocation_children_query(parent_name):
	CostCenterAllocationPercentage = frappe.qb.DocType("Cost Center Allocation Percentage")
	return (
		frappe.qb.from_(CostCenterAllocationPercentage)
		.select(
			CostCenterAllocationPercentage.cost_center,
			CostCenterAllocationPercentage.percentage,
		)
		.where(CostCenterAllocationPercentage.parent == parent_name)
	)


def _project_risk_exists(pb):
	pbd_risk = frappe.qb.DocType("Project Budget Dimension")
	return ExistsCriterion(
		frappe.qb.from_(pbd_risk)
		.select(1)
		.where((pbd_risk.parent == pb.name) & (pbd_risk.doc == RISK_DIMENSION))
	)


def build_budget_raw_query(filters, *, project=None, projects=None, pb_names=None):
	"""Build grouped budget/plan vs forecast query for one or many projects.

	pb_names=None keeps the unrestricted report path. Metrics pass get_list-visible names.
	"""
	pba = frappe.qb.DocType("Project Budget Amount")
	pb = frappe.qb.DocType("Project Budget")
	pbd = frappe.qb.DocType("Project Budget Dimension")
	project_doctype = frappe.qb.DocType("Project")
	risk_exists = _project_risk_exists(pb)

	query = (
		frappe.qb.from_(pba)
		.inner_join(pb)
		.on(pba.parent == pb.name)
		.left_join(pbd)
		.on((pbd.parent == pb.name) & (pbd.doc == "Task"))
		.left_join(project_doctype)
		.on(pb.pb_project == project_doctype.name)
		.select(
			pb.pb_account,
			pb.pb_project.as_("project"),
			pbd.docname.as_("task"),
			pba.pba_year,
			pba.pba_month,
			Case()
			.when(risk_exists, DATA_TYPE_WITH_RISK)
			.when((pbd.docname.isnull()) | (pbd.docname == ""), DATA_TYPE_WITHOUT_TASK)
			.else_(DATA_TYPE_WITH_TASK)
			.as_("data_type"),
			Sum(Coalesce(pba.pba_plan, 0)).as_("plan"),
			Sum(Coalesce(pba.pba_expected, 0)).as_("forecast"),
		)
		.where(
			pba.pba_year.between(
				cint(filters.get("from_year")),
				cint(filters.get("to_year")),
			)
		)
		.groupby(
			pb.pb_account,
			pb.pb_project,
			pbd.docname,
			pb.name,
			pba.pba_year,
			pba.pba_month,
		)
		.orderby(pb.pb_project)
		.orderby(pb.pb_account)
		.orderby(pba.pba_year)
		.orderby(pba.pba_month)
	)

	from_month = cint(filters.get("from_month"))
	if from_month:
		query = query.where(pba.pba_month >= from_month)

	to_month = cint(filters.get("to_month"))
	if to_month:
		query = query.where(pba.pba_month <= to_month)

	if projects is not None:
		query = query.where(pb.pb_project.isin(projects))
	elif project:
		query = query.where(pb.pb_project == project)

	if filters.get("project_portfolio"):
		query = query.where(
			project_doctype.custom_project_portfolio == filters.get("project_portfolio")
		)

	query = apply_optional_name_filter(query, pb.name, pb_names)
	return query


def build_drill_budget_projects_query(filters, account_names, month_periods):
	"""Distinct projects with budget rows for drill-down account/period selection."""
	pba = frappe.qb.DocType("Project Budget Amount")
	pb = frappe.qb.DocType("Project Budget")
	project_doctype = frappe.qb.DocType("Project")

	query = (
		frappe.qb.from_(pba)
		.inner_join(pb)
		.on(pba.parent == pb.name)
		.left_join(project_doctype)
		.on(pb.pb_project == project_doctype.name)
		.select(pb.pb_project.as_("project"))
		.distinct()
		.where(pb.pb_account.isin(account_names))
	)

	period_criterion = _period_match_criterion(pba, month_periods)
	if period_criterion is not None:
		query = query.where(period_criterion)

	project = filters.get("project")
	if project:
		if isinstance(project, (list, tuple)):
			query = query.where(
				pb.pb_project == project[0] if len(project) == 1 else pb.pb_project.isin(project)
			)
		else:
			query = query.where(pb.pb_project == project)

	portfolio = filters.get("project_portfolio")
	if portfolio:
		if isinstance(portfolio, (list, tuple)):
			query = query.where(
				project_doctype.custom_project_portfolio == portfolio[0]
				if len(portfolio) == 1
				else project_doctype.custom_project_portfolio.isin(portfolio)
			)
		else:
			query = query.where(project_doctype.custom_project_portfolio == portfolio)

	return query


def execute_raw_budget_data(filters, *, project=None, projects=None, pb_names=None):
	"""Execute the raw budget query and return rows as dicts."""
	return build_budget_raw_query(
		filters,
		project=project,
		projects=projects,
		pb_names=pb_names,
	).run(as_dict=True)


# ---------------------------------------------------------------------------
# GL actuals & draft invoices
# ---------------------------------------------------------------------------


def build_gl_actual_query(
	filters,
	start_date,
	end_date,
	*,
	group_by_project=False,
	apply_cc_ba_filters=True,
	gle_names=None,
):
	GLE = frappe.qb.DocType("GL Entry")
	Account = frappe.qb.DocType("Account")
	year_expr = _year(GLE.posting_date)
	month_expr = _month(GLE.posting_date)

	select_fields = [
		GLE.account,
		year_expr.as_("year"),
		month_expr.as_("month"),
		Account.root_type,
		Round(Sum(GLE.debit), 0).as_("debit"),
		Round(Sum(GLE.credit), 0).as_("credit"),
	]
	group_fields = [GLE.account, year_expr, month_expr, Account.root_type]
	order_fields = [year_expr, month_expr, GLE.account]

	if group_by_project:
		select_fields.insert(0, GLE.project)
		group_fields.insert(0, GLE.project)
		order_fields.insert(0, GLE.project)

	query = (
		frappe.qb.from_(GLE)
		.inner_join(Account)
		.on(GLE.account == Account.name)
		.select(*select_fields)
		.where(GLE.posting_date.between(start_date, end_date))
		.where(GLE.is_cancelled == 0)
		.groupby(*group_fields)
		.orderby(*order_fields)
	)

	query = apply_company_filter(query, GLE.company, filters)
	query = apply_dimension_filter(query, filters, "project", GLE.project)
	if apply_cc_ba_filters:
		query = apply_dimension_filter(query, filters, "cost_center", GLE.cost_center)
		query = apply_dimension_filter(query, filters, "business_area", GLE.business_area)
	query = apply_finance_book_filter(query, GLE.finance_book, filters)
	query = apply_portfolio_filter(query, GLE.project, filters)
	query = apply_writable_projects_filter(query, GLE.project, filters)
	query = apply_optional_name_filter(query, GLE.name, gle_names)
	return query


def build_sales_draft_query(
	filters,
	start_date,
	end_date,
	*,
	group_by_project=False,
	apply_cc_ba_filters=True,
):
	SI = frappe.qb.DocType("Sales Invoice")
	SII = frappe.qb.DocType("Sales Invoice Item")
	year_expr = _year(SI.posting_date)
	month_expr = _month(SI.posting_date)

	select_fields = [
		SII.income_account.as_("account"),
		year_expr.as_("year"),
		month_expr.as_("month"),
		Sum(SII.amount).as_("amount"),
	]
	group_fields = [SII.income_account, year_expr, month_expr]

	if group_by_project:
		select_fields.insert(0, SI.project)
		group_fields.insert(0, SI.project)

	query = (
		frappe.qb.from_(SI)
		.inner_join(SII)
		.on(SII.parent == SI.name)
		.select(*select_fields)
		.where(SI.docstatus == 0)
		.where(SI.posting_date.between(start_date, end_date))
		.groupby(*group_fields)
	)

	query = apply_company_filter(query, SI.company, filters)
	query = apply_dimension_filter(query, filters, "project", SI.project)
	if apply_cc_ba_filters:
		query = apply_dimension_filter(query, filters, "cost_center", SII.cost_center)
		query = apply_dimension_filter(query, filters, "business_area", SI.business_area)
	query = apply_portfolio_filter(query, SI.project, filters)
	query = apply_writable_projects_filter(query, SI.project, filters)
	return query


def build_purchase_draft_query(
	filters,
	start_date,
	end_date,
	*,
	group_by_project=False,
	apply_cc_ba_filters=True,
):
	PI = frappe.qb.DocType("Purchase Invoice")
	PII = frappe.qb.DocType("Purchase Invoice Item")
	year_expr = _year(PI.posting_date)
	month_expr = _month(PI.posting_date)

	select_fields = [
		PII.expense_account.as_("account"),
		year_expr.as_("year"),
		month_expr.as_("month"),
		Sum(PII.amount).as_("amount"),
	]
	group_fields = [PII.expense_account, year_expr, month_expr]

	if group_by_project:
		select_fields.insert(0, PII.project)
		group_fields.insert(0, PII.project)

	query = (
		frappe.qb.from_(PI)
		.inner_join(PII)
		.on(PII.parent == PI.name)
		.select(*select_fields)
		.where(PI.docstatus == 0)
		.where(PI.posting_date.between(start_date, end_date))
		.groupby(*group_fields)
	)

	query = apply_company_filter(query, PI.company, filters)
	query = apply_dimension_filter(query, filters, "project", PII.project)
	if apply_cc_ba_filters:
		query = apply_dimension_filter(query, filters, "cost_center", PII.cost_center)
		query = apply_dimension_filter(query, filters, "business_area", PI.business_area)
	query = apply_portfolio_filter(query, PII.project, filters)
	query = apply_writable_projects_filter(query, PII.project, filters)
	return query
