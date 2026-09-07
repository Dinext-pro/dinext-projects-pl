frappe.provide("dinext_projects_pl");

const PROJECT_BUDGET_OPEN_TAB_STORAGE_KEY = "dinext_projects_pl_open_budget_tab";

dinext_projects_pl.PROJECT_BUDGET_OPEN_TAB_STORAGE_KEY = PROJECT_BUDGET_OPEN_TAB_STORAGE_KEY;

dinext_projects_pl.navigate_to_project_budget = function (project) {
	if (!project) return;

	try {
		sessionStorage.setItem(PROJECT_BUDGET_OPEN_TAB_STORAGE_KEY, project);
	} catch (e) {
		// ignore storage errors (private mode, etc.)
	}

	frappe.route_options = frappe.route_options || {};
	frappe.route_options.open_pl_tab = 1;

	const route = frappe.get_route();
	if (
		route &&
		route[0] === "Form" &&
		route[1] === "Project" &&
		route[2] === project &&
		cur_frm &&
		cur_frm.docname === project &&
		typeof dinext_projects_pl.open_project_budget_tab === "function"
	) {
		dinext_projects_pl.open_project_budget_tab(cur_frm);
		return;
	}

	frappe.set_route("Form", "Project", project);
};

/** Compat for budget_report drilldown and older callers. */
dinext_projects_pl.navigate_to_project_pl = dinext_projects_pl.navigate_to_project_budget;

/** List of active (non-cancelled) Budgets for project. */
dinext_projects_pl.navigate_to_active_budgets = function (frm) {
	const project = frm?.doc?.name;
	if (!project) return;

	frappe.route_options = {
		project: project,
		docstatus: ["!=", 2],
	};
	if (frm.doc.company) {
		frappe.route_options.company = frm.doc.company;
	}
	frappe.set_route("List", "Budget");
};

/** ERPNext Budget Variance Report scoped to this project. */
dinext_projects_pl.navigate_to_budget_variance_report = function (frm) {
	const project = frm?.doc?.name;
	if (!project) return;

	const today = frappe.datetime.get_today();
	const fiscalYear =
		typeof erpnext !== "undefined" && erpnext.utils?.get_fiscal_year
			? erpnext.utils.get_fiscal_year(today)
			: null;

	frappe.route_options = {
		company: frm.doc.company || frappe.defaults.get_user_default("Company"),
		budget_against: "Project",
		budget_against_filter: [project],
		period: "Yearly",
	};
	if (fiscalYear) {
		frappe.route_options.from_fiscal_year = fiscalYear;
		frappe.route_options.to_fiscal_year = fiscalYear;
	}
	frappe.set_route("query-report", "Budget Variance Report");
};
