# Copyright (c) 2026, Dinext and Contributors
# See license.txt

"""Deterministic seed/reset for Project Budget Plan vs Forecast report integration tests."""

import frappe
from erpnext.accounts.doctype.cost_center.test_cost_center import create_cost_center

PREFIX = "TEST-PL-BVF"
COMPANY = "_Test Company"

PROJECT_A = f"{PREFIX}-PRJ-A"
PROJECT_B = f"{PREFIX}-PRJ-B"

CC_MAIN_KEY = f"{PREFIX}-CC-MAIN"
CC_A_KEY = f"{PREFIX}-CC-A"
CC_B_KEY = f"{PREFIX}-CC-B"
CC_OTHER_KEY = f"{PREFIX}-CC-OTHER"

CC_ALLOCATION_VALID_FROM = "2026-01-01"
PROJECT_CC_VALID_FROM = "2026-01-01"

BUDGET_PERIODS = (
	(2026, 4, 100, 110),
	(2026, 5, 200, 220),
	(2026, 6, 300, 330),
)

APR_2026_EXPENSE_DEBIT_DATE = "2026-04-10"
APR_2026_EXPENSE_CREDIT_DATE = "2026-04-20"
APR_2026_INCOME_DATE = "2026-04-15"


def reset_bvf_report_seed():
	"""Remove BVF report seed data in reverse dependency order."""
	company_abbr = _company_abbr()
	cost_centers = _cost_center_names(company_abbr)
	main_cc = cost_centers["main"]

	for project in (PROJECT_A, PROJECT_B):
		_cancel_and_delete_journal_entries_for_project(project)
		_delete_project_budgets(project)

	_delete_cost_center_allocations(main_cc)

	for project in (PROJECT_A, PROJECT_B):
		if frappe.db.exists("Project", project):
			frappe.delete_doc("Project", project, ignore_permissions=True, force=1)

	frappe.db.commit()


def seed_bvf_report_seed():
	"""Create BVF report seed data; returns dict of created entity names."""
	reset_bvf_report_seed()

	if not frappe.db.exists("Company", COMPANY):
		raise AssertionError(f"ERPNext {COMPANY!r} is required for BVF report seed")

	company_abbr = _company_abbr()
	cost_centers = _ensure_cost_centers(company_abbr)
	expense_account = _get_pl_account(COMPANY, "Expense")
	income_account = _get_pl_account(COMPANY, "Income")
	balancing_account = _get_balancing_account(COMPANY)

	project_a = _create_project(
		PROJECT_A,
		f"{PREFIX} Project A",
		cost_centers["main"],
	)
	project_b = _create_project(PROJECT_B, f"{PREFIX} Project B", cost_center=None)

	cc_allocation = _create_cost_center_allocation(
		cost_centers["main"],
		{
			cost_centers["a"]: 60,
			cost_centers["b"]: 40,
		},
	)

	project_budget = _create_project_budget(PROJECT_A, expense_account)

	journal_entries = _create_journal_entries(
		project=PROJECT_A,
		expense_account=expense_account,
		income_account=income_account,
		balancing_account=balancing_account,
		main_cost_center=cost_centers["main"],
	)

	frappe.db.commit()

	return {
		"company": COMPANY,
		"company_abbr": company_abbr,
		"projects": {"a": project_a, "b": project_b},
		"cost_centers": cost_centers,
		"cost_center_allocation": cc_allocation,
		"expense_account": expense_account,
		"income_account": income_account,
		"balancing_account": balancing_account,
		"project_budget": project_budget,
		"journal_entries": journal_entries,
	}


def _company_abbr():
	return frappe.db.get_value("Company", COMPANY, "abbr")


def _cc_name(cost_center_key, company_abbr):
	return f"{cost_center_key} - {company_abbr}"


def _cost_center_names(company_abbr):
	return {
		"main": _cc_name(CC_MAIN_KEY, company_abbr),
		"a": _cc_name(CC_A_KEY, company_abbr),
		"b": _cc_name(CC_B_KEY, company_abbr),
		"other": _cc_name(CC_OTHER_KEY, company_abbr),
	}


def _ensure_cost_centers(company_abbr):
	cost_centers = {}
	for key, cc_key in (
		("main", CC_MAIN_KEY),
		("a", CC_A_KEY),
		("b", CC_B_KEY),
		("other", CC_OTHER_KEY),
	):
		cost_centers[key] = _cc_name(cc_key, company_abbr)
		if not frappe.db.exists("Cost Center", cost_centers[key]):
			create_cost_center(cost_center_name=cc_key, company=COMPANY)
	return cost_centers


def _create_project(name, project_name, cost_center):
	project = frappe.get_doc(
		{
			"doctype": "Project",
			"name": name,
			"project_name": project_name,
			"company": COMPANY,
			"expected_start_date": "2026-01-01",
			"expected_end_date": "2026-12-31",
		}
	)
	if cost_center and frappe.get_meta("Project").has_field("custom_cost_center_table"):
		project.append(
			"custom_cost_center_table",
			{
				"cct_valid_from": PROJECT_CC_VALID_FROM,
				"cct_cost_center": cost_center,
			},
		)
	project.insert(ignore_permissions=True, ignore_mandatory=True)
	return project.name


def _create_cost_center_allocation(main_cost_center, allocation_percentages):
	doc = frappe.new_doc("Cost Center Allocation")
	doc.main_cost_center = main_cost_center
	doc.company = COMPANY
	doc.valid_from = CC_ALLOCATION_VALID_FROM
	for cc, percentage in allocation_percentages.items():
		doc.append("allocation_percentages", {"cost_center": cc, "percentage": percentage})
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc.name


def _create_project_budget(project, expense_account):
	doc = frappe.new_doc("Project Budget")
	doc.pb_project = project
	doc.pb_account = expense_account
	for year, month, plan, forecast in BUDGET_PERIODS:
		doc.append(
			"project_budget_amount",
			{
				"pba_year": year,
				"pba_month": month,
				"pba_plan": plan,
				"pba_expected": forecast,
			},
		)
	doc.save(ignore_permissions=True)
	return doc.name


def _create_journal_entries(
	project,
	expense_account,
	income_account,
	balancing_account,
	main_cost_center,
):
	journal_entries = []

	journal_entries.append(
		_post_journal(
			project=project,
			posting_date=APR_2026_EXPENSE_DEBIT_DATE,
			accounts=[
				{"account": expense_account, "debit": 1000, "credit": 0, "cost_center": main_cost_center},
				{"account": balancing_account, "debit": 0, "credit": 1000},
			],
		)
	)
	journal_entries.append(
		_post_journal(
			project=project,
			posting_date=APR_2026_EXPENSE_CREDIT_DATE,
			accounts=[
				{"account": expense_account, "debit": 0, "credit": 200, "cost_center": main_cost_center},
				{"account": balancing_account, "debit": 200, "credit": 0},
			],
		)
	)
	journal_entries.append(
		_post_journal(
			project=project,
			posting_date=APR_2026_INCOME_DATE,
			accounts=[
				{"account": income_account, "debit": 0, "credit": 5000},
				{"account": balancing_account, "debit": 5000, "credit": 0},
			],
		)
	)
	return journal_entries


def _post_journal(project, posting_date, accounts):
	company_currency = frappe.db.get_value("Company", COMPANY, "default_currency")
	je = frappe.new_doc("Journal Entry")
	je.company = COMPANY
	je.posting_date = posting_date
	for line in accounts:
		je.append(
			"accounts",
			{
				"account": line["account"],
				"debit_in_account_currency": line["debit"],
				"credit_in_account_currency": line["credit"],
				"cost_center": line.get("cost_center"),
				"project": project,
			},
		)
	if company_currency:
		je.multi_currency = 1
	je.insert(ignore_permissions=True)
	je.submit()
	return je.name


def _cancel_and_delete_journal_entries_for_project(project):
	je_names = frappe.db.sql_list(
		"""
		SELECT DISTINCT parent
		FROM `tabJournal Entry Account`
		WHERE project = %s
		""",
		project,
	)
	for name in reversed(je_names):
		if not frappe.db.exists("Journal Entry", name):
			continue
		doc = frappe.get_doc("Journal Entry", name)
		if doc.docstatus == 1:
			doc.cancel()
		frappe.delete_doc("Journal Entry", name, ignore_permissions=True, force=1)


def _delete_project_budgets(project):
	for name in frappe.get_all("Project Budget", filters={"pb_project": project}, pluck="name"):
		frappe.delete_doc("Project Budget", name, ignore_permissions=True, force=1)


def _delete_cost_center_allocations(main_cost_center):
	for name in frappe.get_all(
		"Cost Center Allocation",
		filters={"main_cost_center": main_cost_center, "company": COMPANY},
		pluck="name",
	):
		doc = frappe.get_doc("Cost Center Allocation", name)
		if doc.docstatus == 1:
			doc.cancel()
		frappe.delete_doc("Cost Center Allocation", name, ignore_permissions=True, force=1)


def _get_pl_account(company, root_type):
	company_currency = frappe.db.get_value("Company", company, "default_currency")
	account = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"is_group": 0,
			"report_type": "Profit and Loss",
			"root_type": root_type,
			"account_currency": company_currency,
		},
		"name",
	)
	if not account:
		account = frappe.db.get_value(
			"Account",
			{
				"company": company,
				"is_group": 0,
				"report_type": "Profit and Loss",
				"root_type": root_type,
			},
			"name",
		)
	if not account:
		raise AssertionError(f"No {root_type} Profit and Loss account found for {company!r}")
	return account


def _get_balancing_account(company):
	company_currency = frappe.db.get_value("Company", company, "default_currency")
	account = frappe.db.get_value(
		"Account",
		{"company": company, "account_type": "Bank", "is_group": 0, "account_currency": company_currency},
		"name",
	)
	if not account:
		account = frappe.db.get_value(
			"Account",
			{"company": company, "root_type": "Asset", "is_group": 0, "account_currency": company_currency},
			"name",
		)
	if not account:
		raise AssertionError(f"No balancing account found for {company!r}")
	return account
