"""Boundary checks that need neither a database nor fixture mutations."""

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from dinext_projects_pl.liquidity import api
from dinext_projects_pl.liquidity.model import Filters, Snapshot
from dinext_projects_pl.liquidity.presentation import Calendar


class TestLiquidityContracts(unittest.TestCase):
	def setUp(self):
		previous_flags = getattr(frappe.local, "flags", None)
		frappe.local.flags = frappe._dict(in_test=True, mute_messages=True)
		self.addCleanup(setattr, frappe.local, "flags", previous_flags)
		self.translation = patch.object(api, "_", lambda message: message)
		self.translation.start()
		self.addCleanup(self.translation.stop)

	def test_malformed_cell_arguments_fail_before_reading_sources(self):
		valid = dict(filters={"company": "Company"}, node_key="root", period_key="total", metric="actual")
		for field, values in {
			"node_key": [None, [], {}, False, ""],
			"period_key": [None, [], {}, False, ""],
			"metric": [None, [], {}, False, "unknown"],
			"start": [None, [], {}, True, float("inf"), -1, "1.5"],
			"page_length": [None, [], {}, True, float("inf"), 0, 201],
		}.items():
			for value in values:
				with (
					self.subTest(field=field, value=value),
					patch.object(api, "calendar") as load,
					patch.object(frappe, "throw", side_effect=ValueError),
				):
					with self.assertRaises(ValueError):
						api.get_cell_details(**dict(valid, **{field: value}))
					load.assert_not_called()

	def test_malformed_children_key_fails_before_reading_sources(self):
		for key in (None, [], {}, False, "", "x" * 6001):
			with (
				self.subTest(key=key),
				patch.object(api, "calendar") as load,
				patch.object(frappe, "throw", side_effect=ValueError),
			):
				with self.assertRaises(ValueError):
					api.get_children({"company": "Company"}, key)
				load.assert_not_called()

	def test_option_arguments_cannot_be_database_filter_expressions(self):
		for field, values in {
			"kind": [[], {}, None, "unknown"],
			"company": [["!=", ""], {}, False, ""],
			"txt": [[], {}, None, 1],
			"party_type": [[], {}, False, "unknown"],
		}.items():
			for value in values:
				with (
					self.subTest(field=field, value=value),
					patch.object(api, "require_access") as access,
					patch.object(frappe, "get_list") as query,
					patch.object(frappe, "throw", side_effect=ValueError),
				):
					with self.assertRaises(ValueError):
						api.get_options(**{"kind": "project", "company": "Company", field: value})
					access.assert_not_called()
					query.assert_not_called()

	def test_falsey_filter_containers_do_not_expand_selection(self):
		for field in ("grain", "grouping", "direction", "party_type"):
			for value in ([], {}, False, 0):
				with self.subTest(field=field, value=value), self.assertRaises(ValueError):
					Filters.parse({"company": "Company", field: value}, date(2026, 10, 29))

	def test_company_choices_work_before_a_company_is_selected(self):
		with (
			patch.object(frappe, "get_roles", return_value=["Accounts Manager"]),
			patch.object(frappe, "has_permission", return_value=True),
			patch.object(frappe, "get_list", return_value=[frappe._dict(name="Company")]) as query,
		):
			self.assertEqual(
				api.get_options("company", company=""), [{"value": "Company", "description": ""}]
			)
			self.assertEqual(query.call_args.kwargs["filters"], {})

	def test_valid_http_pagination_and_unknown_period_keep_domain_contract(self):
		today = date(2026, 10, 29)
		calendar = Calendar(Filters.parse({"company": "Company"}, today), Snapshot(today, "USD"), [])
		result = calendar.details("root", "total", "actual", "0", "50")
		self.assertEqual((result["start"], result["page_length"], result["count"]), (0, 50, 0))
		with self.assertRaisesRegex(ValueError, "Invalid calendar cell"):
			calendar.details("root", "unknown", "actual")

	def test_fixture_mutations_are_post_only(self):
		from dinext_projects_pl.tests import liquidity_ui_helpers

		for name in ("seed", "pay_standalone", "move_request", "execute_order", "cover_request", "cleanup"):
			with self.subTest(name=name):
				method = getattr(liquidity_ui_helpers, name)
				self.assertIn(method, frappe.whitelisted)
				self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[method], ["POST"])
				self.assert_http_post_only(method)

	def assert_http_post_only(self, method):
		from frappe import handler

		request = SimpleNamespace(method="GET")
		with (
			patch.object(frappe, "local", SimpleNamespace(request=request)),
			patch.object(handler, "throw_permission_error", side_effect=frappe.PermissionError) as denied,
		):
			with self.assertRaises(frappe.PermissionError):
				handler.is_valid_http_method(method)
			denied.assert_called_once()
			request.method = "POST"
			denied.reset_mock()
			handler.is_valid_http_method(method)
			denied.assert_not_called()

	def test_post_decorator_supports_legacy_no_keyword_wrapper(self):
		from dinext_projects_pl.tests import liquidity_ui_helpers as helpers

		# This signature/return behavior matches the pinned CI Frappe revision.
		def legacy_whitelist_for_tests(function):
			return frappe.whitelist()(function)

		def fixture():
			return "fixture"

		with patch.object(helpers, "whitelist_for_tests", legacy_whitelist_for_tests):
			method = helpers.whitelist_fixture_post(fixture)
		try:
			self.assertIsNot(method, fixture)
			self.assertIn(method, frappe.whitelisted)
			self.assertNotIn(fixture, frappe.allowed_http_methods_for_whitelisted_func)
			self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[method], ["POST"])
			self.assert_http_post_only(method)
		finally:
			frappe.whitelisted.remove(method)
			frappe.allowed_http_methods_for_whitelisted_func.pop(method)

	def test_post_decorator_does_not_bypass_test_server_registration_gate(self):
		from dinext_projects_pl.tests import liquidity_ui_helpers as helpers

		def fixture():
			return "fixture"

		with patch.object(helpers, "whitelist_for_tests", lambda function: function):
			self.assertIs(helpers.whitelist_fixture_post(fixture), fixture)
		self.assertNotIn(fixture, frappe.whitelisted)
		self.assertNotIn(fixture, frappe.allowed_http_methods_for_whitelisted_func)

		frappe.flags.in_test = False
		with (
			patch.object(frappe, "request", SimpleNamespace(method="POST")),
			patch.object(frappe, "local", SimpleNamespace(dev_server=False)),
			patch.object(frappe, "throw", side_effect=frappe.PermissionError),
		):
			with self.assertRaises(frappe.PermissionError):
				helpers.whitelist_fixture_post(fixture)
		self.assertNotIn(fixture, frappe.whitelisted)
		self.assertNotIn(fixture, frappe.allowed_http_methods_for_whitelisted_func)

	def test_fixture_execution_guard_rejects_production_even_if_imported_in_tests(self):
		from dinext_projects_pl.tests import liquidity_ui_helpers as helpers

		with (
			patch.object(frappe, "request", SimpleNamespace(method="POST")),
			patch.object(frappe, "local", SimpleNamespace(dev_server=False)),
			patch.object(frappe, "conf", frappe._dict(allow_tests=True)),
			patch.object(frappe, "throw", side_effect=frappe.PermissionError),
		):
			with self.assertRaises(frappe.PermissionError):
				helpers.guard()
