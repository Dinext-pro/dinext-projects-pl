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
