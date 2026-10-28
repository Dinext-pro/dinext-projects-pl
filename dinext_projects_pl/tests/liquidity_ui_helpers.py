"""Restricted UI fixtures; unavailable on a production HTTP server."""

import json
import secrets
from functools import wraps
from pathlib import Path

import frappe
from frappe.tests.ui_test_helpers import whitelist_for_tests
from frappe.utils import add_days, today
from frappe.utils.password import update_password

from dinext_projects_pl.tests import liquidity_fixtures as fixtures

OPERATOR = "liquidity-operator@example.invalid"
FINANCIER = "liquidity-financier@example.invalid"
MANAGER = "liquidity-manager@example.invalid"
DENIED = "liquidity-denied@example.invalid"
PNL_TEST_ROLE = "_Test Liquidity P&L Reader"


def guard():
	if not frappe.conf.allow_tests or (frappe.request and not getattr(frappe.local, "dev_server", False)):
		frappe.throw("Liquidity UI fixtures require a development test site", frappe.PermissionError)
	if frappe.session.user not in ("Administrator", OPERATOR):
		frappe.throw("Not permitted", frappe.PermissionError)
	frappe.flags.mute_emails = True


def fixture_action(function):
	"""Authorize the test operator before bounded fixture writes, without changing the HTTP sid."""

	@wraps(function)
	def wrapped(*args, **kwargs):
		guard()
		previous = frappe.session.user
		try:
			frappe.session.user = "Administrator"
			return function(*args, **kwargs)
		finally:
			frappe.session.user = previous

	return wrapped


def bootstrap():
	guard()
	fixtures.setup_company()
	# The local P&L source has no existing non-Administrator report permission.
	# This temporary role belongs only to our UI operator and is deleted by cleanup.
	fixtures.ensure({"doctype": "Role", "name": PNL_TEST_ROLE, "role_name": PNL_TEST_ROLE})
	if not frappe.db.exists("Custom DocPerm", {"parent": "Project Budget", "role": PNL_TEST_ROLE}):
		frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": "Project Budget",
				"role": PNL_TEST_ROLE,
				"permlevel": 0,
				"read": 1,
				"report": 1,
			}
		).insert()
		frappe.clear_cache(doctype="Project Budget")
	password = secrets.token_urlsafe(24)
	for email, roles in (
		(
			OPERATOR,
			[
				PNL_TEST_ROLE,
				"System Manager",
				"Accounts Manager",
				"Accounts User",
				"Sales Manager",
				"Sales User",
				"Purchase Manager",
				"Purchase User",
				"Stock Manager",
				"Projects Manager",
				"Dinext_Sales_Manager",
				"Dinext_Project_Manager",
				"Dinext_Management",
				"Dinext_User",
			],
		),
		(
			FINANCIER,
			[
				"Accounts Manager",
				"Accounts User",
				"Projects Manager",
				"Sales User",
				"Purchase User",
				"Dinext_Financier",
				"Dinext_Management",
				# The clean Dinext fixtures grant Company/Account/Journal Entry
				# read to this existing role. Accounts Manager keeps this user
				# in finance mode; the separate MANAGER has no finance roles.
				"Dinext_Project_Manager",
				"Dinext_User",
			],
		),
		(MANAGER, ["Dinext_Project_Manager", "Dinext_User"]),
		(DENIED, ["Employee"]),
	):
		if frappe.db.exists("User", email):
			doc = frappe.get_doc("User", email)
		else:
			doc = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": "Liquidity Test",
					"send_welcome_email": 0,
					"user_type": "System User",
					"language": "ru",
				}
			)
		doc.set("roles", [{"role": role} for role in roles if frappe.db.exists("Role", role)])
		doc.save()
		update_password(email, password)
		frappe.defaults.set_user_default("Company", fixtures.COMPANY, user=email)
	previous = frappe.session.user
	try:
		frappe.set_user(FINANCIER)
		missing = [
			doctype
			for doctype in (
				"Company", "Account", "GL Entry", "Sales Order", "Purchase Order",
				"Sales Invoice", "Purchase Invoice", "Payment Request", "Payment Order",
				"Payment Entry", "Journal Entry", "Project", "Contract",
			)
			if not frappe.has_permission(doctype, "read")
		]
		if missing:
			raise AssertionError(f"Test financier lacks source read permissions: {missing}; roles={frappe.get_roles()}")
	finally:
		frappe.set_user(previous)
	from dinext_projects_pl.liquidity.setup import install_report, install_workspace_links

	install_report()
	install_workspace_links()
	path = Path("/tmp/liquidity-ui-context.json")
	path.write_text(
		json.dumps(
			{
				"operator": OPERATOR,
				"financier": FINANCIER,
				"manager": MANAGER,
				"denied": DENIED,
				"password": password,
			}
		)
	)
	path.chmod(0o600)
	return {"credentials_file": str(path)}


def clear_transactions():
	# Only documents in this helper's dedicated company are touched.
	for dt in (
		"Payment Entry",
		"Journal Entry",
		"Payment Order",
		"Payment Request",
		"Sales Invoice",
		"Purchase Invoice",
		"Sales Order",
		"Purchase Order",
	):
		for name in frappe.get_all(dt, filters={"company": fixtures.COMPANY, "docstatus": 1}, pluck="name"):
			frappe.get_doc(dt, name).cancel()


@whitelist_for_tests
@fixture_action
def seed(scenario="base"):
	guard()
	if scenario not in (
		"base",
		"visual",
		"standalone",
		"request",
		"empty",
		"many",
		"overdue",
		"overdue_request",
		"undated",
		"zero",
		"outward",
		"pnl",
	):
		frappe.throw("Unknown fixture scenario")
	context = fixtures.setup_company()
	clear_transactions()
	context["from_date"] = today()
	context["to_date"] = add_days(today(), 90)
	if scenario == "pnl":
		from frappe.utils import getdate

		day = getdate(today())
		account = frappe.db.get_value(
			"Account", {"company": fixtures.COMPANY, "root_type": "Income", "is_group": 0}, "name"
		)
		frappe.get_doc(
			{
				"doctype": "Project Budget",
				"pb_project": context["project"],
				"pb_account": account,
				"project_budget_amount": [
					{
						"pba_year": day.year,
						"pba_month": day.month,
						"pba_plan": 100,
						"pba_expected": 120,
						"pba_has_expected": 1,
					}
				],
			}
		).insert()
	if scenario == "empty":
		return context
	order = fixtures.sales_order(context)
	context["order"] = order.name
	context["customer"] = order.customer
	context["contract"] = fixtures.contract(order).name
	if scenario == "standalone":
		context["request"] = fixtures.payment_request(order, 100, add_days(today(), 14)).name
	else:
		invoice = (
			fixtures.purchase_invoice(context)
			if scenario == "outward"
			else fixtures.sales_invoice(order, 100 if scenario in ("request", "zero") else 60)
		)
		context["invoice"] = invoice.name
		context["invoice_type"] = invoice.doctype
		request = (
			fixtures.payment_request(invoice, 100 if scenario == "outward" else 60, add_days(today(), 21))
			if scenario in ("request", "outward", "overdue_request")
			else None
		)
		if scenario != "outward":
			context["payment"] = fixtures.pay(
				context, invoice, 100 if scenario == "zero" else 20, request
			).name
		if request:
			context["request"] = request.name
		if scenario == "outward":
			context["payment_order"] = fixtures.payment_order(context, request).name
		if scenario in ("overdue", "overdue_request", "undated"):
			# Existing legacy data may lack dates even though current entry forms require them.
			due = add_days(today(), -7) if scenario != "undated" else None
			invoice.db_set("due_date", due)
			for row in invoice.payment_schedule:
				frappe.db.set_value("Payment Schedule", row.name, "due_date", due)
	if scenario == "visual":
		context["purchase_invoice"] = fixtures.purchase_invoice(context).name
	if scenario == "many":
		for i in range(55):
			fixtures.sales_order(context, amount=i + 1)
	# Share only this scenario's primary documents with the project manager.
	from frappe.share import add

	if not frappe.db.exists(
		"User Permission", {"user": MANAGER, "allow": "Project", "for_value": context["project"]}
	):
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": MANAGER,
				"allow": "Project",
				"for_value": context["project"],
				"apply_to_all_doctypes": 1,
			}
		).insert()
	for dt, name in [
		("Company", fixtures.COMPANY),
		("Project", context["project"]),
		("Contract", context["contract"]),
		("Sales Order", context["order"]),
		(context.get("invoice_type", "Sales Invoice"), context.get("invoice")),
		("Payment Entry", context.get("payment")),
		("Payment Request", context.get("request")),
	]:
		if name:
			add(dt, name, user=MANAGER, read=1)
	return context


@whitelist_for_tests
@fixture_action
def pay_standalone(request_name):
	guard()
	request = frappe.get_doc("Payment Request", request_name)
	if request.company != fixtures.COMPANY or request.reference_doctype not in (
		"Sales Order",
		"Purchase Order",
	):
		frappe.throw("Not permitted", frappe.PermissionError)
	context = {"bank": "Liquidity Bank A - LQC"}
	doc = frappe.get_doc(request.reference_doctype, request.reference_name)
	return fixtures.pay(context, doc, 30, request).name


@whitelist_for_tests
@fixture_action
def move_request(request_name, days=35):
	guard()
	request = frappe.get_doc("Payment Request", request_name)
	if request.company != fixtures.COMPANY or int(days) not in (-7, 14, 35):
		frappe.throw("Not permitted", frappe.PermissionError)
	# Test-only mutation of an owned request; production report never writes source documents.
	request.db_set("transaction_date", add_days(today(), int(days)))
	return request.transaction_date


@whitelist_for_tests
@fixture_action
def execute_order(order_name, via="entry"):
	doc = frappe.get_doc("Payment Order", order_name)
	if doc.company != fixtures.COMPANY or via not in ("entry", "journal") or len(doc.references) != 1:
		frappe.throw("Not permitted", frappe.PermissionError)
	request = frappe.get_doc("Payment Request", doc.references[0].payment_request)
	invoice = frappe.get_doc("Purchase Invoice", request.reference_name)
	if request.company != fixtures.COMPANY or invoice.company != fixtures.COMPANY:
		frappe.throw("Not permitted", frappe.PermissionError)
	context = {"bank": "Liquidity Bank A - LQC"}
	if via == "entry":
		pe = fixtures.pay(context, invoice, 30, request)
		pe.db_set("payment_order", doc.name)
		return pe.name
	return fixtures.journal(
		context,
		[
			{
				"account": invoice.credit_to,
				"party_type": "Supplier",
				"party": fixtures.SUPPLIER,
				"debit_in_account_currency": 30,
				"reference_type": "Purchase Invoice",
				"reference_name": invoice.name,
			},
			{"account": context["bank"], "credit_in_account_currency": 30},
		],
		payment_order=doc.name,
	).name


@whitelist_for_tests
@fixture_action
def cover_request(request_name, amount=60):
	request = frappe.get_doc("Payment Request", request_name)
	if (
		request.company != fixtures.COMPANY
		or request.reference_doctype != "Sales Order"
		or int(amount) not in (40, 60)
	):
		frappe.throw("Not permitted", frappe.PermissionError)
	order = frappe.get_doc("Sales Order", request.reference_name)
	if order.company != fixtures.COMPANY:
		frappe.throw("Not permitted", frappe.PermissionError)
	invoice = fixtures.sales_invoice(order, int(amount), advances=True)
	po = fixtures.payment_order(
		{"bank": "Liquidity Bank A - LQC"}, request, invoice=invoice, covered=int(amount)
	)
	return {"invoice": invoice.name, "payment_order": po.name}


@whitelist_for_tests
@fixture_action
def cleanup():
	guard()
	clear_transactions()
	projects = frappe.get_all("Project", filters={"company": fixtures.COMPANY}, pluck="name")
	if projects:
		for name in frappe.get_all("Project Budget", filters={"pb_project": ["in", projects]}, pluck="name"):
			frappe.delete_doc("Project Budget", name, force=True)
	# Reconciliation creates cyclic invoice/advance references. Force is bounded
	# to our dedicated fixture company, after all submissions have been cancelled.
	for name in frappe.get_all(
		"Contract", filters={"contract_terms": "Liquidity calendar automated test"}, pluck="name"
	):
		contract = frappe.get_doc("Contract", name)
		if (
			contract.document_type in ("Sales Order", "Purchase Order")
			and frappe.db.get_value(contract.document_type, contract.document_name, "company")
			== fixtures.COMPANY
		):
			frappe.delete_doc("Contract", name, force=True)
	for dt in (
		"Payment Order",
		"Payment Request",
		"Sales Invoice",
		"Purchase Invoice",
		"Payment Entry",
		"Journal Entry",
		"Sales Order",
		"Purchase Order",
	):
		for name in frappe.get_all(dt, filters={"company": fixtures.COMPANY}, pluck="name"):
			frappe.delete_doc(dt, name, force=True)
	for user in (FINANCIER, MANAGER, DENIED, OPERATOR):
		if frappe.db.exists("User", user):
			frappe.delete_doc("User", user, force=True)
	for name in frappe.get_all("Custom DocPerm", filters={"role": PNL_TEST_ROLE}, pluck="name"):
		frappe.delete_doc("Custom DocPerm", name, force=True)
	if frappe.db.exists("Role", PNL_TEST_ROLE):
		frappe.delete_doc("Role", PNL_TEST_ROLE, force=True)
	frappe.clear_cache(doctype="Project Budget")
	return {"cleared": True}
