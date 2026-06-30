# Copyright (c) 2026, Dinext and Contributors

import frappe
from frappe.tests.utils import FrappeTestCase

from dinext_projects_pl.dinext_projects_pl.report.project_budget_plan_vs_forecast.filter_utils import (
	_expand_company_filter,
	get_company_names,
	normalize_filters,
)


class TestProjectBudgetPlanVsForecastCompanyFilter(FrappeTestCase):
	def test_get_company_names_returns_scalar_as_list(self):
		self.assertEqual(get_company_names({"company": "Dinext"}), ["Dinext"])

	def test_get_company_names_returns_list(self):
		self.assertEqual(
			get_company_names({"company": ["Dinext", "Child Co"]}),
			["Dinext", "Child Co"],
		)

	def test_expand_company_filter_includes_descendants(self):
		parent = "_Test Company 3"
		child = "_Test Company 4 with child company"

		if not frappe.db.exists("Company", parent):
			self.skipTest("ERPNext test companies are not available")

		filters = {"company": parent}
		_expand_company_filter(filters)

		companies = get_company_names(filters)
		self.assertIn(parent, companies)
		if frappe.db.exists("Company", child):
			self.assertIn(child, companies)

	def test_normalize_filters_expands_company_before_loaders(self):
		parent = "_Test Company 3"
		if not frappe.db.exists("Company", parent):
			self.skipTest("ERPNext test companies are not available")

		filters = normalize_filters(
			{
				"company": parent,
				"from_period": "2026-01-01",
				"to_period": "2026-12-31",
			}
		)

		companies = get_company_names(filters)
		self.assertIn(parent, companies)
