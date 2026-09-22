// Клиентский скрипт для Doctype "Project"
frappe.provide("dinext_projects_pl");

const PROJECT_BUDGET_TAB_FIELDNAME = "custom_pl";
const PROJECT_BUDGET_TABLE_SELECTOR = ".budget-container .budget-table";

function get_project_budget_open_tab_storage_key() {
	return dinext_projects_pl.PROJECT_BUDGET_OPEN_TAB_STORAGE_KEY || "dinext_projects_pl_open_budget_tab";
}

function should_open_project_budget_tab(frm) {
	if (!frm || frm.doctype !== "Project" || !frm.docname) {
		return false;
	}
	if (frappe.route_options && cint(frappe.route_options.open_pl_tab)) {
		return true;
	}
	try {
		return sessionStorage.getItem(get_project_budget_open_tab_storage_key()) === frm.docname;
	} catch (e) {
		return false;
	}
}

function clear_project_budget_open_tab_request(project) {
	if (frappe.route_options && cint(frappe.route_options.open_pl_tab)) {
		delete frappe.route_options.open_pl_tab;
	}
	try {
		if (sessionStorage.getItem(get_project_budget_open_tab_storage_key()) === project) {
			sessionStorage.removeItem(get_project_budget_open_tab_storage_key());
		}
	} catch (e) {
		// ignore
	}
}

function activate_project_budget_tab(frm) {
	if (frm.layout && typeof frm.layout.select_tab === "function") {
		frm.layout.select_tab(PROJECT_BUDGET_TAB_FIELDNAME);
		return;
	}

	const $wrapper = frm.$wrapper || $(frm.wrapper);
	const tab_selector = '[data-fieldname="' + PROJECT_BUDGET_TAB_FIELDNAME + '"]';

	if (frm.layout && frm.layout.tabs) {
		const tab = frm.layout.tabs.find(function (item) {
			return item.df && item.df.fieldname === PROJECT_BUDGET_TAB_FIELDNAME;
		});
		if (tab) {
			tab.set_active();
			return;
		}
	}

	if ($wrapper.find(tab_selector).length) {
		$wrapper.find(tab_selector).tab("show");
	}
}

function open_project_budget_tab_and_scroll(frm) {
	activate_project_budget_tab(frm);
	scroll_to_project_budget_table(frm);
}

function schedule_open_project_budget_tab(frm) {
	if (!should_open_project_budget_tab(frm)) {
		return;
	}
	clear_project_budget_open_tab_request(frm.docname);

	const $wrapper = frm.$wrapper || $(frm.wrapper);
	const tab_selector = '[data-fieldname="' + PROJECT_BUDGET_TAB_FIELDNAME + '"]';

	const apply = function () {
		open_project_budget_tab_and_scroll(frm);
	};

	$wrapper
		.off("shown.bs.tab.project_pl_open", tab_selector)
		.one("shown.bs.tab.project_pl_open", tab_selector, function () {
			scroll_to_project_budget_table(frm);
		});

	apply();
	frappe.after_ajax(apply);
	setTimeout(apply, 150);
	setTimeout(apply, 500);
	setTimeout(apply, 1200);

	if ($wrapper) {
		$wrapper.off("render_complete.project_pl_open").one("render_complete.project_pl_open", apply);
	}
}

dinext_projects_pl.open_project_budget_tab = schedule_open_project_budget_tab;

if (!dinext_projects_pl._project_budget_route_hook_installed) {
	dinext_projects_pl._project_budget_route_hook_installed = true;
	frappe.router.on("change", function () {
		var route = frappe.get_route();
		if (
			route[0] !== "Form" ||
			route[1] !== "Project" ||
			!route[2] ||
			!cur_frm ||
			cur_frm.doctype !== "Project" ||
			cur_frm.docname !== route[2]
		) {
			return;
		}
		schedule_open_project_budget_tab(cur_frm);
	});
}

function scroll_to_project_budget_table(frm) {
	const max_attempts = 40;
	let attempts = 0;
	const $wrapper = frm.$wrapper || $(frm.wrapper);
	const $tabPane = $wrapper.find("#project-custom_pl");

	function find_target() {
		let $target = $wrapper.find(PROJECT_BUDGET_TABLE_SELECTOR).first();
		if ($target.length) {
			return $target;
		}

		const field = frm.get_field && frm.get_field("custom_planning");
		if (field && field.$wrapper && field.$wrapper.length) {
			$target = field.$wrapper.find(".budget-table").first();
			if ($target.length) {
				return $target;
			}
			return field.$wrapper;
		}

		if ($tabPane.length) {
			return $tabPane;
		}

		return $();
	}

	function try_scroll() {
		attempts += 1;
		if ($tabPane.length && !$tabPane.hasClass("active")) {
			activate_project_budget_tab(frm);
		}

		const $target = find_target();
		const tab_is_active = !$tabPane.length || $tabPane.hasClass("active");
		if ($target.length && tab_is_active) {
			frappe.utils.scroll_to($target, true, 15);
			return;
		}
		if (attempts < max_attempts) {
			setTimeout(try_scroll, 150);
		}
	}

	setTimeout(try_scroll, 50);
}

frappe.ui.form.on("Project", {
    refresh: function(frm) {
        render_budget_table(frm);
        schedule_open_project_budget_tab(frm);
    },
    onload_post_render: function(frm) {
        schedule_open_project_budget_tab(frm);
    }
});

/**
 * Реестр подпунктов меню "Рассчитать прогноз" над таблицей P&L.
 * Канон: project_budget_forecast_menu / refresh_project_budget_forecast_dropdown.
 * Alias (старый risk / cutover): project_pl_forecast_menu / refresh_pl_forecast_dropdown.
 *   frappe.provide("dinext_projects.project_budget_forecast_menu");
 *   dinext_projects.project_budget_forecast_menu = dinext_projects.project_budget_forecast_menu || [];
 *   dinext_projects.project_budget_forecast_menu.push({ label: __("My Forecast"), action: function(frm) { ... } });
 * Кнопка меню отображается только если добавлен хотя бы один подпункт.
 * Если меню изменено после первичной отрисовки — вызвать refresh_*_forecast_dropdown(frm).
 */
frappe.provide("dinext_projects");
frappe.provide("dinext_projects.project_budget_forecast_menu");
frappe.provide("dinext_projects.project_pl_forecast_menu");
if (!Array.isArray(dinext_projects.project_budget_forecast_menu)) {
    dinext_projects.project_budget_forecast_menu = Array.isArray(
        dinext_projects.project_pl_forecast_menu
    )
        ? dinext_projects.project_pl_forecast_menu
        : [];
}
if (
    !Array.isArray(dinext_projects.project_pl_forecast_menu) ||
    dinext_projects.project_pl_forecast_menu !== dinext_projects.project_budget_forecast_menu
) {
    if (
        Array.isArray(dinext_projects.project_pl_forecast_menu) &&
        dinext_projects.project_pl_forecast_menu.length &&
        !dinext_projects.project_budget_forecast_menu.length
    ) {
        dinext_projects.project_budget_forecast_menu = dinext_projects.project_pl_forecast_menu;
    }
    dinext_projects.project_pl_forecast_menu = dinext_projects.project_budget_forecast_menu;
}

function render_pl_chart(frm, init = true) {
    if (
        window.ProjectBudget?.hasPlAmountAccess &&
        !window.ProjectBudget.hasPlAmountAccess(frm?.project_budget)
    ) {
        return;
    }
    const renderChart = globalThis.render_pl_chart_impl;
    if (typeof renderChart !== "function") {
        return;
    }

    return renderChart(frm, init);
}

dinext_projects_pl.renderPlChart = render_pl_chart;

function refresh_project_budget_forecast_dropdown(frm) {
	const api = get_project_budget_api();
	if (api?.refreshForecastDropdown) {
		api.refreshForecastDropdown(frm);
		return;
	}
	window.ProjectBudget?.refreshForecastDropdown?.(frm);
}

frappe.provide("dinext_projects");
dinext_projects.refresh_project_budget_forecast_dropdown = refresh_project_budget_forecast_dropdown;
dinext_projects.refresh_pl_forecast_dropdown = refresh_project_budget_forecast_dropdown;

/**
 * Resolve at call time — doctype_js may load bridge/project_pl out of order;
 * a module-level const can capture `undefined` and silently skip mount.
 * @returns {{ whenReady?: Function, destroy?: Function } | undefined}
 */
function get_project_budget_api() {
	return dinext_projects_pl.projectBudget;
}

/**
 * @param {Form} frm
 * @param {() => void|Promise} [callback]
 * @returns {Promise}
 */
function when_project_budget_ready(frm, callback) {
	return new Promise((resolve, reject) => {
		const api = get_project_budget_api();
		if (!api?.whenReady) {
			resolve();
			return;
		}
		api.whenReady(frm, () => {
			Promise.resolve()
				.then(() => callback?.())
				.then(resolve)
				.catch(reject);
		});
	});
}

/**
 * P&L / Budget shell — table host only; domain buttons live in DinextTable toolbar.
 */
function render_budget_table(frm) {
	const wrapper = frm.get_field("custom_planning").$wrapper;
	const budgetApi = get_project_budget_api();
	if (budgetApi?.destroy) {
		budgetApi.destroy(frm);
	}
	wrapper.addClass("budget-container").empty();
	$('<div class="budget-table"></div>').appendTo(wrapper);
	schedule_pl_mount(frm);
}

/** Shell on refresh; grid only when tab P&L is visible. */
function schedule_pl_mount(frm) {
	const mountWhenVisible = () =>
		when_project_budget_ready(frm, () => {
			if (frm._plRefreshPending) {
				frm._plRefreshPending = false;
				return Promise.resolve(window.ProjectBudget?.refresh?.(frm)).then(() => {
					render_pl_chart(frm);
				});
			}
		});

	const tryBind = () => {
		const bind = window.project_workload_assignment?.bindLazyTabMount;
		if (typeof bind !== "function") {
			return false;
		}
		bind(frm, "custom_planning", mountWhenVisible);
		return true;
	};

	if (tryBind()) {
		return;
	}

	// Bundle installs bindLazyTabMount; do not call whenReady here (that mounts eagerly).
	const bundle = frappe.assets.bundled_asset("project-budget.bundle.js");
	frappe.require([bundle], () => {
		if (!tryBind()) {
			console.error("[Project P&L] bindLazyTabMount missing after bundle — refuse eager mount");
		}
	});
}

/** Month periods for P&L / risk / WE forecast (quarter/year branches removed). */
function get_budget_display_periods(frm, periodType) {
    const periods = [];
    if (!frm?.doc?.expected_start_date || !frm.doc.expected_end_date) {
        return periods;
    }
    // Only month granularity is used by live callers.
    if (periodType && periodType !== "month") {
        periodType = "month";
    }

    const month_start = frappe.datetime.month_start();
    const start = frappe.datetime.str_to_obj(frm.doc.expected_start_date);
    const end = frappe.datetime.str_to_obj(frm.doc.expected_end_date);
    let current = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= last) {
        const year = current.getFullYear();
        const month = current.getMonth() + 1;
        let is_past;
        if (
            frm.budget_view_options == __("Fact only") ||
            frm.budget_view_options == __("Actual only")
        ) {
            is_past = true;
        } else if (frm.budget_view_options == __("Forecast only")) {
            is_past = false;
        } else {
            is_past = frappe.datetime.obj_to_str(current) < month_start;
        }
        periods.push({ year, month, is_past });
        current = frappe.datetime.str_to_obj(
            frappe.datetime.add_months(frappe.datetime.obj_to_str(current), 1)
        );
    }
    return periods;
}

/**
 * Reload DinextTable + chart after external budget changes (WE / risk / forecast).
 * If P&L tab hidden — defer until next tab show (see schedule_pl_mount).
 * @param {Form} frm
 */
function refresh_project_budget(frm) {
	const visible = window.project_workload_assignment?.isFieldTabVisible?.(frm, "custom_planning");
	// Only mount/refresh when visibly on P&L. undefined/false → defer.
	if (visible !== true) {
		frm._plRefreshPending = true;
		return;
	}
	when_project_budget_ready(frm, () => {
		window.ProjectBudget?.refresh?.(frm);
		render_pl_chart(frm);
	});
}

/** Cross-app: WE sync after task tree change → refresh Project Budget. */
globalThis.updateTaskDimension = (frm) => {
	refresh_project_budget(frm);
};

/** True when Project Budget grid has data. */
function is_project_budget_ready(frm) {
	return Boolean(frm?.project_budget?.rows?.length || frm?.project_budget?.table);
}
