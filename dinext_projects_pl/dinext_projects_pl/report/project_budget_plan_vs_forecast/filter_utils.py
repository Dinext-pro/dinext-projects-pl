# Copyright (c) 2025, Dinord and contributors
import frappe
from frappe.utils import cint, getdate, parse_json, today


def normalize_list_filter(value):
	"""Normalize MultiSelectList filter value to a list or None."""
	if value is None or value == "" or value == []:
		return None

	if isinstance(value, list):
		normalized = [item for item in value if item]
		return normalized or None

	if isinstance(value, str):
		value = value.strip()
		if not value:
			return None

		if value.startswith("["):
			try:
				parsed = parse_json(value)
			except Exception:
				parsed = None

			if isinstance(parsed, list):
				normalized = [item for item in parsed if item]
				return normalized or None

		return [value]

	return None


def normalize_filters(filters):
	"""Normalize report filters in place and return the same dict."""
	if filters is None:
		filters = {}

	from_period = filters.get("from_period")
	to_period = filters.get("to_period")

	granularity = (filters.get("period_granularity") or "month").lower()
	year_only_granularity = granularity in ("quarter", "year", "quarterly", "yearly")

	if from_period:
		from_date = getdate(from_period)
		filters["from_year"] = from_date.year
		filters["from_month"] = 1 if year_only_granularity else from_date.month

	if to_period:
		to_date = getdate(to_period)
		filters["to_year"] = to_date.year
		filters["to_month"] = 12 if year_only_granularity else to_date.month

	# Defaults when report opens before client filter defaults are applied.
	current = getdate(today())
	if not cint(filters.get("from_year")):
		filters["from_year"] = current.year
	if not cint(filters.get("from_month")):
		filters["from_month"] = 1
	if not cint(filters.get("to_year")):
		filters["to_year"] = current.year
	if not cint(filters.get("to_month")):
		filters["to_month"] = 12

	if filters.get("from_year"):
		filters["from_year"] = cint(filters["from_year"])

	if filters.get("to_year"):
		filters["to_year"] = cint(filters["to_year"])

	if filters.get("from_month"):
		filters["from_month"] = cint(filters["from_month"])

	if filters.get("to_month"):
		filters["to_month"] = cint(filters["to_month"])

	_expand_company_filter(filters)

	for field in ("project", "project_portfolio", "cost_center", "business_area", "company"):
		if field not in filters:
			continue

		normalized = normalize_list_filter(filters.get(field))
		if normalized is None:
			filters.pop(field, None)
			continue

		# Keep single-value filters scalar for existing loader/query code paths.
		if len(normalized) == 1:
			filters[field] = normalized[0]
		else:
			filters[field] = normalized

	_expand_hierarchy_filters(filters)

	from .permissions import apply_report_project_permissions

	apply_report_project_permissions(filters)

	return filters


def get_company_names(filters):
	"""Return selected company and all nested-set descendants as a list."""
	company = filters.get("company") or frappe.defaults.get_user_default("Company")
	if isinstance(company, (list, tuple)):
		return [name for name in company if name]
	if company:
		return [company]
	return []


def apply_company_sql(conditions, filter_values, filters, sql_column):
	"""Append equality or IN condition for company filter values."""
	companies = get_company_names(filters)
	if not companies:
		return

	if len(companies) == 1:
		conditions.append(f"{sql_column} = %(company)s")
		filter_values["company"] = companies[0]
	else:
		conditions.append(f"{sql_column} IN %(company)s")
		filter_values["company"] = tuple(companies)


def _expand_company_filter(filters):
	"""Include descendant companies for group/parent company selection."""
	company = filters.get("company")
	if not company:
		return

	names = company if isinstance(company, list) else [company]
	expanded = get_descendants("Company", names, "parent_company")
	if not expanded:
		return

	filters["company"] = expanded[0] if len(expanded) == 1 else expanded


def _expand_hierarchy_filters(filters):
	"""Include descendant nodes for hierarchical dimensions (CC / Business Area)."""
	hierarchy_fields = (
		("cost_center", "Cost Center", "parent_cost_center"),
		("business_area", "Business Area", "parent_business_area"),
	)

	for field, doctype, parent_field in hierarchy_fields:
		value = filters.get(field)
		if not value:
			continue

		names = value if isinstance(value, list) else [value]
		expanded = get_descendants(doctype, names, parent_field)
		if not expanded:
			continue

		filters[field] = expanded[0] if len(expanded) == 1 else expanded


def append_company_sql(query, params, filters, sql_expr):
	"""Append AND clause for company filter values."""
	companies = get_company_names(filters)
	if not companies:
		return query

	if len(companies) == 1:
		query += f" AND {sql_expr} = %(company)s"
		params["company"] = companies[0]
	else:
		query += f" AND {sql_expr} IN %(company)s"
		params["company"] = tuple(companies)

	return query


def apply_dimension_sql(conditions, filter_values, filters, field, sql_column):
	"""Append equality or IN condition for scalar / multi-select filter values."""
	value = filters.get(field)
	if not value:
		return

	if isinstance(value, (list, tuple)):
		if len(value) == 1:
			conditions.append(f"{sql_column} = %({field})s")
			filter_values[field] = value[0]
		else:
			conditions.append(f"{sql_column} IN %({field})s")
			filter_values[field] = tuple(value)
	else:
		conditions.append(f"{sql_column} = %({field})s")
		filter_values[field] = value


def append_dimension_sql(query, params, filters, field, sql_expr):
	"""Append AND clause to a dynamic SQL string for scalar / multi-select values."""
	value = filters.get(field)
	if not value:
		return query

	if isinstance(value, (list, tuple)):
		if len(value) == 1:
			query += f" AND {sql_expr} = %({field})s"
			params[field] = value[0]
		else:
			query += f" AND {sql_expr} IN %({field})s"
			params[field] = tuple(value)
	else:
		query += f" AND {sql_expr} = %({field})s"
		params[field] = value

	return query


def get_descendants(doctype, names, parent_field):
	"""Expand nested hierarchy nodes to include all descendants."""
	if not names:
		return []

	if isinstance(names, str):
		names = [names]

	names = [name for name in names if name]
	if not names:
		return []

	table = frappe.utils.get_table_name(doctype, wrap_in_backticks=True)
	meta = frappe.get_meta(doctype)

	if meta.is_nested_set():
		return frappe.db.sql(
			f"""
			SELECT DISTINCT child.name
			FROM {table} child
			INNER JOIN {table} parent ON
				child.lft >= parent.lft AND child.rgt <= parent.rgt
			WHERE parent.name IN %(names)s
			ORDER BY child.lft
			""",
			{"names": names},
			pluck=True,
		)

	parent_column = f"`{parent_field}`"
	return frappe.db.sql(
		f"""
		WITH RECURSIVE descendants AS (
			SELECT name
			FROM {table}
			WHERE name IN %(names)s
			UNION ALL
			SELECT child.name
			FROM {table} child
			INNER JOIN descendants parent ON child.{parent_column} = parent.name
		)
		SELECT DISTINCT name
		FROM descendants
		ORDER BY name
		""",
		{"names": names},
		pluck=True,
	)


# Match project P&L: risk reserves live in separate Project Budget rows with this dimension
# and are excluded from financial root totals (see project_pl_calc.getFinancialRootRows).
RISK_DIMENSION = "Project Risk"

SQL_EXCLUDE_PROJECT_RISK_BUDGET = """
	AND NOT EXISTS (
		SELECT 1 FROM `tabProject Budget Dimension` pbd_risk
		WHERE pbd_risk.parent = pb.name AND pbd_risk.doc = %(risk_dimension)s
	)
"""


def risk_budget_sql_params():
	return {"risk_dimension": RISK_DIMENSION}
