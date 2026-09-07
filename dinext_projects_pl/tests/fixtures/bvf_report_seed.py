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
BA_A_KEY = f"{PREFIX}-BA-A"
BA_B_KEY = f"{PREFIX}-BA-B"
PORTFOLIO_KEY = f"{PREFIX}-PORTFOLIO"

CC_ALLOCATION_VALID_FROM = "2026-01-01"
BA_VALID_FROM = "2026-01-01"
PROJECT_CC_VALID_FROM = "2026-01-01"

BUDGET_PERIODS = (
	(2026, 4, 100, 110),
	(2026, 5, 200, 220),
	(2026, 6, 300, 330),
)

APR_2026_EXPENSE_DEBIT_DATE = "2026-04-10"
APR_2026_EXPENSE_CREDIT_DATE = "2026-04-20"
APR_2026_INCOME_DATE = "2026-04-15"
MAY_2026_EXPENSE_OTHER_DATE = "2026-05-10"
MAY_2026_EXPENSE_OTHER_AMOUNT = 400
PROJECT_CC_OTHER_FROM = "2026-04-01"


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

	for ba_name in (BA_A_KEY, BA_B_KEY):
		if frappe.db.exists("Business Area", ba_name):
			frappe.delete_doc("Business Area", ba_name, ignore_permissions=True, force=1)

	if frappe.db.exists("Project Portfolio", PORTFOLIO_KEY):
		frappe.delete_doc("Project Portfolio", PORTFOLIO_KEY, ignore_permissions=True, force=1)

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

	business_areas = _ensure_business_areas()
	portfolio = _ensure_project_portfolio()

	project_a = _create_project(
		PROJECT_A,
		f"{PREFIX} Project A",
		cost_center=cost_centers["main"],
		business_area_rows=[
			{
				"valid_from": BA_VALID_FROM,
				"business_area": business_areas["a"],
				"percent": 70,
			},
			{
				"valid_from": BA_VALID_FROM,
				"business_area": business_areas["b"],
				"percent": 30,
			},
		],
	)
	project_b = _create_project(
		PROJECT_B,
		f"{PREFIX} Project B",
		cost_center=None,
		project_portfolio=portfolio,
	)

	cc_allocation = _create_cost_center_allocation(
		cost_centers["main"],
		{
			cost_centers["a"]: 60,
			cost_centers["b"]: 40,
		},
	)

	project_budget_a = _create_project_budget(PROJECT_A, expense_account)
	project_budget_b = _create_project_budget(
		PROJECT_B,
		expense_account,
		periods=((2026, 5, 150, 165),),
	)

	journal_entries = _create_journal_entries(
		project=PROJECT_A,
		expense_account=expense_account,
		income_account=income_account,
		balancing_account=balancing_account,
		main_cost_center=cost_centers["main"],
		other_cost_center=cost_centers["other"],
	)
	journal_entries.extend(
		_create_project_b_journal(
			project=PROJECT_B,
			expense_account=expense_account,
			balancing_account=balancing_account,
			cost_center=cost_centers["other"],
		)
	)

	frappe.db.commit()

	return {
		"company": COMPANY,
		"company_abbr": company_abbr,
		"projects": {"a": project_a, "b": project_b},
		"cost_centers": cost_centers,
		"business_areas": business_areas,
		"project_portfolio": portfolio,
		"cost_center_allocation": cc_allocation,
		"expense_account": expense_account,
		"income_account": income_account,
		"balancing_account": balancing_account,
		"project_budget": project_budget_a,
		"project_budget_b": project_budget_b,
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
	company_root = f"{COMPANY} - {company_abbr}"
	cost_centers = {}

	main_name = _cc_name(CC_MAIN_KEY, company_abbr)
	if not frappe.db.exists("Cost Center", main_name):
		create_cost_center(
			cost_center_name=CC_MAIN_KEY,
			company=COMPANY,
			is_group=1,
			parent_cost_center=company_root,
		)
	else:
		_ensure_cc_group(main_name, company_root)

	cost_centers["main"] = main_name

	for key, cc_key in (("a", CC_A_KEY), ("b", CC_B_KEY)):
		cc_name = _cc_name(cc_key, company_abbr)
		if not frappe.db.exists("Cost Center", cc_name):
			create_cost_center(
				cost_center_name=cc_key,
				company=COMPANY,
				parent_cost_center=main_name,
			)
		else:
			_ensure_cc_parent(cc_name, main_name)
		cost_centers[key] = cc_name

	other_name = _cc_name(CC_OTHER_KEY, company_abbr)
	if not frappe.db.exists("Cost Center", other_name):
		create_cost_center(cost_center_name=CC_OTHER_KEY, company=COMPANY)
	cost_centers["other"] = other_name

	return cost_centers


def _ensure_cc_group(cc_name, parent):
	doc = frappe.get_doc("Cost Center", cc_name)
	changed = False
	if not doc.is_group:
		doc.is_group = 1
		changed = True
	if doc.parent_cost_center != parent:
		doc.parent_cost_center = parent
		changed = True
	if changed:
		doc.save(ignore_permissions=True)


def _ensure_cc_parent(cc_name, parent):
	doc = frappe.get_doc("Cost Center", cc_name)
	if doc.parent_cost_center != parent:
		doc.parent_cost_center = parent
		doc.save(ignore_permissions=True)


def _ensure_business_areas():
	areas = {}
	for key, ba_name in (("a", BA_A_KEY), ("b", BA_B_KEY)):
		if not frappe.db.exists("Business Area", ba_name):
			frappe.get_doc(
				{
					"doctype": "Business Area",
					"name": ba_name,
					"business_area": ba_name,
					"enabled": 1,
				}
			).insert(ignore_permissions=True)
		areas[key] = ba_name
	return areas


def _ensure_project_portfolio():
	if not frappe.db.exists("Project Portfolio", PORTFOLIO_KEY):
		frappe.get_doc(
			{
				"doctype": "Project Portfolio",
				"name": PORTFOLIO_KEY,
				"status": "Активный",
				"description": f"{PREFIX} portfolio for filter matrix tests",
			}
		).insert(ignore_permissions=True)
	return PORTFOLIO_KEY


def _create_project(
	name,
	project_name,
	cost_center=None,
	cost_center_history=None,
	business_area_rows=None,
	project_portfolio=None,
):
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
	if cost_center_history is None and cost_center:
		cost_center_history = [(PROJECT_CC_VALID_FROM, cost_center)]

	if cost_center_history and frappe.get_meta("Project").has_field("custom_cost_center_table"):
		for valid_from, cc in cost_center_history:
			project.append(
				"custom_cost_center_table",
				{
					"cct_valid_from": valid_from,
					"cct_cost_center": cc,
				},
			)

	if business_area_rows and frappe.get_meta("Project").has_field("custom_business_area"):
		for row in business_area_rows:
			project.append("custom_business_area", row)

	if project_portfolio and frappe.get_meta("Project").has_field("custom_project_portfolio"):
		project.custom_project_portfolio = project_portfolio

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


def _create_project_budget(project, expense_account, periods=None):
	doc = frappe.new_doc("Project Budget")
	doc.pb_project = project
	doc.pb_account = expense_account
	for year, month, plan, forecast in periods or BUDGET_PERIODS:
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
	other_cost_center=None,
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
	if other_cost_center:
		journal_entries.append(
			_post_journal(
				project=project,
				posting_date=MAY_2026_EXPENSE_OTHER_DATE,
				accounts=[
					{
						"account": expense_account,
						"debit": MAY_2026_EXPENSE_OTHER_AMOUNT,
						"credit": 0,
						"cost_center": other_cost_center,
					},
					{
						"account": balancing_account,
						"debit": 0,
						"credit": MAY_2026_EXPENSE_OTHER_AMOUNT,
					},
				],
			)
		)
	return journal_entries


def _create_project_b_journal(project, expense_account, balancing_account, cost_center):
	return [
		_post_journal(
			project=project,
			posting_date="2026-05-15",
			accounts=[
				{"account": expense_account, "debit": 300, "credit": 0, "cost_center": cost_center},
				{"account": balancing_account, "debit": 0, "credit": 300},
			],
		)
	]


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
