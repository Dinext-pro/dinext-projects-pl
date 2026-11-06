"""Real ERPNext fixtures in a dedicated test company. No synthetic successful report responses."""

import frappe
from frappe.utils import add_days, getdate, today

COMPANY = "_Test Liquidity Calendar"
CUSTOMER = "_Test Liquidity Customer"
SUPPLIER = "_Test Liquidity Supplier"
ITEM = "_Test Liquidity Service"
PROJECT = "_Test Liquidity Project"


def ensure(doc):
	doc = frappe.get_doc(doc)
	name = doc.get("name")
	if name and frappe.db.exists(doc.doctype, name):
		return frappe.get_doc(doc.doctype, name)
	return doc.insert()


def setup_company():
	previous = frappe.flags.ignore_chart_of_accounts
	try:
		frappe.flags.ignore_chart_of_accounts = False
		ensure(
			{
				"doctype": "Company",
				"name": COMPANY,
				"company_name": COMPANY,
				"abbr": "LQC",
				"default_currency": "USD",
				"country": "United States",
				"create_chart_of_accounts_based_on": "Standard Template",
				"chart_of_accounts": "Standard",
				"enable_perpetual_inventory": 0,
			}
		)
	finally:
		frappe.flags.ignore_chart_of_accounts = previous
	bank_parent = frappe.db.get_value(
		"Account", {"company": COMPANY, "account_type": "Bank", "is_group": 1}, "name"
	)
	assert bank_parent, "Test company must have a chart of accounts"
	for suffix in ("A", "B"):
		ensure(
			{
				"doctype": "Account",
				"name": f"Liquidity Bank {suffix} - LQC",
				"account_name": f"Liquidity Bank {suffix}",
				"company": COMPANY,
				"parent_account": bank_parent,
				"account_type": "Bank",
				"account_currency": "USD",
			}
		)
	ensure(
		{
			"doctype": "Customer Group",
			"name": "_Test Liquidity Customers",
			"customer_group_name": "_Test Liquidity Customers",
			"parent_customer_group": "All Customer Groups",
			"is_group": 0,
		}
	)
	ensure(
		{
			"doctype": "Supplier Group",
			"name": "_Test Liquidity Suppliers",
			"supplier_group_name": "_Test Liquidity Suppliers",
			"parent_supplier_group": "All Supplier Groups",
			"is_group": 0,
		}
	)
	ensure(
		{
			"doctype": "Customer",
			"name": CUSTOMER,
			"customer_name": CUSTOMER,
			"customer_type": "Company",
			"customer_group": "_Test Liquidity Customers",
			"territory": "All Territories",
		}
	)
	ensure(
		{
			"doctype": "Supplier",
			"name": SUPPLIER,
			"supplier_name": SUPPLIER,
			"supplier_type": "Company",
			"supplier_group": "_Test Liquidity Suppliers",
		}
	)
	ensure(
		{
			"doctype": "UOM",
			"name": "_Test Liquidity Unit",
			"uom_name": "_Test Liquidity Unit",
			"must_be_whole_number": 0,
		}
	)
	ensure(
		{
			"doctype": "Item",
			"name": ITEM,
			"item_code": ITEM,
			"item_name": ITEM,
			"item_group": "All Item Groups",
			"stock_uom": "_Test Liquidity Unit",
			"is_stock_item": 0,
		}
	)
	ensure(
		{
			"doctype": "Price List",
			"name": "_Test Liquidity USD",
			"price_list_name": "_Test Liquidity USD",
			"currency": "USD",
			"enabled": 1,
			"selling": 1,
			"buying": 1,
		}
	)
	project = frappe.db.get_value("Project", {"project_name": PROJECT, "company": COMPANY}, "name")
	portfolio = "_Test Liquidity Portfolio"
	if not frappe.db.exists("Project Portfolio", portfolio):
		frappe.get_doc({"doctype": "Project Portfolio", "status": "Активный"}).insert(set_name=portfolio)
	if not project:
		ensure({"doctype": "Project Type", "name": "_Test Liquidity", "project_type": "_Test Liquidity"})
		ensure(
			{
				"doctype": "Project Payment Scheme",
				"name": "_Test Liquidity",
				"payment_scheme": "_Test Liquidity",
			}
		)
		project = (
			frappe.get_doc(
				{
					"doctype": "Project",
					"project_name": PROJECT,
					"company": COMPANY,
					"project_type": "_Test Liquidity",
					"custom_payment_scheme": "_Test Liquidity",
					"custom_project_portfolio": portfolio,
				}
			)
			.insert(set_name=PROJECT)
			.name
		)
	if frappe.db.get_value("Project", project, "custom_project_portfolio") != portfolio:
		frappe.db.set_value("Project", project, "custom_project_portfolio", portfolio)
	from erpnext.accounts.utils import get_fiscal_year

	try:
		get_fiscal_year(today(), company=COMPANY)
	except Exception as exc:
		if exc.__class__.__name__ != "FiscalYearError":
			raise
		year = getdate().year
		ensure(
			{
				"doctype": "Fiscal Year",
				"name": f"_Test Liquidity {year}",
				"year": f"_Test Liquidity {year}",
				"year_start_date": f"{year}-01-01",
				"year_end_date": f"{year}-12-31",
			}
		)
	return {
		"company": COMPANY,
		"project": project,
		"portfolio": portfolio,
		"bank": "Liquidity Bank A - LQC",
		"bank_b": "Liquidity Bank B - LQC",
	}


def sales_order(context, amount=100, project=True, currency="USD", rate=1):
	customer = CUSTOMER
	if currency != "USD":
		base = frappe.db.get_value("Company", COMPANY, "default_receivable_account")
		receivable = f"Liquidity Receivable {currency} - LQC"
		ensure(
			{
				"doctype": "Account",
				"name": receivable,
				"account_name": f"Liquidity Receivable {currency}",
				"company": COMPANY,
				"parent_account": frappe.db.get_value("Account", base, "parent_account"),
				"account_type": "Receivable",
				"account_currency": currency,
			}
		)
		customer = CUSTOMER + " " + currency
		ensure(
			{
				"doctype": "Customer",
				"name": customer,
				"customer_name": customer,
				"customer_type": "Company",
				"customer_group": "_Test Liquidity Customers",
				"territory": "All Territories",
				"default_currency": currency,
				"accounts": [{"company": COMPANY, "account": receivable}],
			}
		)
	doc = frappe.get_doc(
		{
			"doctype": "Sales Order",
			"company": COMPANY,
			"customer": customer,
			"transaction_date": today(),
			"delivery_date": add_days(today(), 7),
			"currency": currency,
			"conversion_rate": rate,
			"selling_price_list": "_Test Liquidity USD",
			"price_list_currency": "USD",
			"plc_conversion_rate": 1,
			"project": context["project"] if project else None,
			"items": [{"item_code": ITEM, "qty": 1, "rate": amount}],
			"payment_schedule": [
				{"due_date": add_days(today(), 7), "invoice_portion": 100, "payment_amount": amount}
			],
		}
	)
	doc.insert()
	doc.submit()
	return doc


def sales_invoice(order, amount=60, advances=False):
	from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

	doc = make_sales_invoice(order.name)
	doc.posting_date = today()
	doc.due_date = add_days(today(), 7)
	doc.items[0].qty = amount / order.items[0].rate
	doc.allocate_advances_automatically = int(advances)
	doc.set(
		"payment_schedule", [{"due_date": doc.due_date, "invoice_portion": 100, "payment_amount": amount}]
	)
	doc.insert()
	doc.submit()
	return doc


def pay(context, doc, amount, request=None, bank_amount=None):
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	pe = get_payment_entry(
		doc.doctype, doc.name, bank_account=context["bank"], party_amount=amount, bank_amount=bank_amount
	)
	pe.posting_date = today()
	pe.reference_no = "Liquidity automated test"
	pe.reference_date = today()
	if request:
		for row in pe.references:
			row.payment_request = request.name
	pe.insert()
	pe.submit()
	return pe


def payment_request(doc, amount, when=None):
	pr = frappe.get_doc(
		{
			"doctype": "Payment Request",
			"payment_request_type": "Inward" if doc.doctype.startswith("Sales") else "Outward",
			"company": COMPANY,
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"party_type": "Customer" if doc.doctype.startswith("Sales") else "Supplier",
			"party": doc.get("customer") or doc.get("supplier"),
			"project": doc.get("project"),
			"currency": doc.currency,
			"party_account_currency": doc.get("party_account_currency") or "USD",
			"grand_total": amount,
			"transaction_date": when or today(),
			"mute_email": 1,
		}
	)
	pr.flags.mute_email = True
	pr.insert()
	pr.submit()
	return pr


def contract(doc):
	result = frappe.get_doc(
		{
			"doctype": "Contract",
			"party_type": "Customer",
			"party_name": CUSTOMER,
			"document_type": doc.doctype,
			"document_name": doc.name,
			"contract_terms": "Liquidity calendar automated test",
			"start_date": today(),
			"end_date": add_days(today(), 90),
			"is_signed": 1,
		}
	)
	result.insert()
	return result


def purchase_invoice(context, amount=100, currency="USD", rate=1):
	supplier, payable = SUPPLIER, None
	if currency != "USD":
		payable = f"Liquidity Payable {currency} - LQC"
		base = frappe.db.get_value("Company", COMPANY, "default_payable_account")
		ensure(
			{
				"doctype": "Account",
				"name": payable,
				"account_name": f"Liquidity Payable {currency}",
				"company": COMPANY,
				"parent_account": frappe.db.get_value("Account", base, "parent_account"),
				"account_type": "Payable",
				"account_currency": currency,
			}
		)
		supplier = SUPPLIER + " " + currency
		ensure(
			{
				"doctype": "Supplier",
				"name": supplier,
				"supplier_name": supplier,
				"supplier_type": "Company",
				"supplier_group": "_Test Liquidity Suppliers",
				"default_currency": currency,
				"accounts": [{"company": COMPANY, "account": payable}],
			}
		)
	doc = frappe.get_doc(
		{
			"doctype": "Purchase Invoice",
			"company": COMPANY,
			"supplier": supplier,
			"credit_to": payable,
			"posting_date": today(),
			"due_date": add_days(today(), 7),
			"currency": currency,
			"conversion_rate": rate,
			"buying_price_list": "_Test Liquidity USD",
			"price_list_currency": "USD",
			"plc_conversion_rate": 1,
			"items": [{"item_code": ITEM, "qty": 1, "rate": amount, "project": context["project"]}],
			"payment_schedule": [
				{"due_date": add_days(today(), 7), "invoice_portion": 100, "payment_amount": amount}
			],
		}
	)
	doc.insert()
	doc.submit()
	return doc


def payment_order(context, request=None, invoice=None, covered=None, parts=1, entry=None):
	bank = ensure({"doctype": "Bank", "name": "_Test Liquidity Bank", "bank_name": "_Test Liquidity Bank"})
	bank_account = frappe.db.get_value("Bank Account", {"account": context["bank"]}, "name")
	if not bank_account:
		bank_account = (
			frappe.get_doc(
				{
					"doctype": "Bank Account",
					"account_name": "_Test Liquidity Bank Account",
					"bank": bank.name,
					"is_company_account": 1,
					"company": COMPANY,
					"account": context["bank"],
					"bank_account_no": "LIQUIDITY-TEST-ONLY",
				}
			)
			.insert()
			.name
		)
	doc = frappe.get_doc(
		{
			"doctype": "Payment Order",
			"company": COMPANY,
			"posting_date": today(),
			"payment_order_type": "Payment Entry" if entry else "Payment Request",
			"company_bank_account": bank_account,
			"account": context["bank"],
			"references": [
				{
					"reference_doctype": entry.doctype
					if entry
					else invoice.doctype
					if invoice
					else request.reference_doctype,
					"reference_name": entry.name
					if entry
					else invoice.name
					if invoice
					else request.reference_name,
					"payment_request": request.name if request else None,
					"amount": (
						covered
						if covered is not None
						else entry.paid_amount
						if entry
						else request.grand_total
					)
					/ parts,
					"bank_account": bank_account,
					"supplier": entry.party
					if entry and entry.party_type == "Supplier"
					else request.party
					if request and request.party_type == "Supplier"
					else None,
				}
				for _ in range(parts)
			],
		}
	)
	doc.insert()
	doc.submit()
	return doc


def journal(context, rows, payment_order=None, voucher_type="Bank Entry"):
	doc = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"company": COMPANY,
			"posting_date": today(),
			"voucher_type": voucher_type,
			"cheque_no": "Liquidity automated test",
			"cheque_date": today(),
			"payment_order": payment_order,
			"accounts": rows,
		}
	)
	doc.insert()
	doc.submit()
	return doc
