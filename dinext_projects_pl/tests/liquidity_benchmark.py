"""Rollback-only DB benchmark. Run with bench execute, never exposed over HTTP.

Clone a controller-validated chain through bulk_insert to isolate report read cost
from thousands of unrelated document-submit hooks. Each measured chain has real
database children, payment ledger rows and cash GL rows.

Bootstrap liquidity_ui_helpers first to create the real test financier; run its
cleanup afterwards. The measured financial documents themselves always roll back.
"""

import json
from collections import defaultdict
from pathlib import Path
from time import perf_counter

import frappe
from frappe.utils import add_days, today

from dinext_projects_pl.liquidity.api import get_calendar, get_cell_details
from dinext_projects_pl.liquidity.sources import FINANCE_ROLES
from dinext_projects_pl.tests import liquidity_fixtures as fixtures


def profile():
	import cProfile

	profiler = cProfile.Profile()
	try:
		profiler.enable()
		return run(chains=25)
	finally:
		profiler.disable()
		profiler.dump_stats("/tmp/liquidity-profile.pstats")


def run(chains=2000, repetitions=5):
	if frappe.request or frappe.session.user != "Administrator" or not frappe.conf.allow_tests:
		frappe.throw("Run the benchmark from the test-site CLI as Administrator", frappe.PermissionError)
	user = "liquidity-financier@example.invalid"
	if not frappe.db.exists("User", user) or not FINANCE_ROLES.intersection(frappe.get_roles(user)):
		raise ValueError("Bootstrap liquidity_ui_helpers before running the benchmark")
	chains, repetitions = int(chains), int(repetitions)
	if not 1 <= chains <= 2500 or not 5 <= repetitions <= 10:
		raise ValueError("Invalid benchmark size")
	frappe.db.savepoint("liquidity_benchmark")
	previous = frappe.session.user
	try:
		context = fixtures.setup_company()
		if any(
			frappe.db.exists(dt, {"company": fixtures.COMPANY, "docstatus": 1})
			for dt in ("Sales Order", "Sales Invoice", "Payment Request", "Payment Entry")
		):
			raise ValueError("Finish/clean up the UI fixtures before the isolated benchmark")
		order = fixtures.sales_order(context)
		invoice = fixtures.sales_invoice(order, 60)
		payment = fixtures.pay(context, invoice, 20)
		request = fixtures.payment_request(invoice, 40, add_days(today(), 14))
		payment_order = fixtures.payment_order(context, request, parts=2)
		contract = fixtures.contract(order)
		documents = [order, invoice, payment, request, payment_order, contract]
		templates = defaultdict(list)
		for doc in documents:
			for part in [doc, *doc.get_all_children()]:
				templates[part.doctype].append(dict(part.get_valid_dict()))
		for dt in ("GL Entry", "Payment Ledger Entry"):
			for name in frappe.get_all(
				dt,
				filters={"company": fixtures.COMPANY, "voucher_no": ["in", [invoice.name, payment.name]]},
				pluck="name",
			):
				templates[dt].append(dict(frappe.get_doc(dt, name).get_valid_dict()))
		original_names = [r["name"] for rows in templates.values() for r in rows]
		for dt, rows in templates.items():
			Path("/tmp/liquidity-benchmark-progress.json").write_text(
				json.dumps({"phase": "fixtures", "doctype": dt})
			)
			columns = set(frappe.db.get_table_columns(dt))
			fields = [field for field in rows[0] if field in columns]

			def values():
				for i in range(1, chains):
					mapping = {name: f"LQBENCH-{i:04d}-{j:03d}" for j, name in enumerate(original_names)}
					for row in rows:
						yield [
							mapping.get(row.get(field), row.get(field))
							if isinstance(row.get(field), str)
							else row.get(field)
							for field in fields
						]

			frappe.db.bulk_insert(dt, fields, values(), chunk_size=500)
		filters = {"company": fixtures.COMPANY, "from_date": today(), "to_date": add_days(today(), 90)}
		frappe.set_user(user)
		records = []
		for name, operation, limit in (
			("summary", lambda: get_calendar(filters, depth=2), 5),
			("details", lambda: get_cell_details(filters, "root", "total", "forecast"), 2),
		):
			Path("/tmp/liquidity-benchmark-progress.json").write_text(
				json.dumps({"phase": "warmup", "operation": name})
			)
			operation()  # warm metadata/permission caches
			for iteration in range(repetitions):
				count = 0
				original_sql = frappe.db.sql

				def counted(*args, **kwargs):
					nonlocal count
					count += 1
					return original_sql(*args, **kwargs)

				frappe.db.sql = counted
				try:
					started = perf_counter()
					result = operation()
					elapsed = perf_counter() - started
				finally:
					frappe.db.sql = original_sql
				if name == "summary":
					assert result["directions"]["in"]["total__forecast"] == chains * 40
					assert result["directions"]["in"]["total__actual"] == chains * 20
					assert result["directions"]["in"]["total__plan"] == chains * 80
				else:
					assert result["count"] == chains and result["total"] == chains * 40
				records.append(
					{
						"operation": name,
						"iteration": iteration + 1,
						"seconds": round(elapsed, 4),
						"queries": count,
						"target_seconds": limit,
						"passed": elapsed <= limit,
					}
				)
				Path("/tmp/liquidity-benchmark-progress.json").write_text(
					json.dumps({"phase": "measure", "measurements": records}, indent=2)
				)
		output = {
			"source_documents": chains * 5,
			"payment_order_rows": chains * 2,
			"chains": chains,
			"user_mode": "financier",
			"measurements": records,
			"passed": all(r["passed"] for r in records),
		}
		Path("/tmp/liquidity-benchmark.json").write_text(json.dumps(output, indent=2))
		return output
	finally:
		frappe.set_user(previous)
		frappe.db.rollback(save_point="liquidity_benchmark")
