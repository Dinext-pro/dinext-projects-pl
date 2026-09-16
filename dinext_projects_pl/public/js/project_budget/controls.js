/**
 * P&L toolbar domain chrome + fullscreen overlay portal.
 * Pattern mirrors WE work_efforts/table/controls.js.
 */

import { normalizeDeltaMode } from "./delta-mode.js";
import { getForecastMenuItems } from "./forecast-menu.js";

const PERIOD_TYPES = ["month", "quarter", "year"];

function viewLabelByKey(key) {
	if (key === "forecast_only") {
		return __("Forecast only");
	}
	if (key === "actual_only") {
		return __("Actual only");
	}
	return __("Forecast and actual");
}

function viewKeyByLabel(label) {
	if (label === __("Forecast only") || label === "Forecast only") {
		return "forecast_only";
	}
	if (label === __("Actual only") || label === "Actual only") {
		return "actual_only";
	}
	return "forecast_actual";
}

function toolbarPrefsKey(frm) {
	const name = frm.doc?.name;
	if (!name || frm.is_new?.()) {
		return null;
	}
	return `project-budget:prefs:${name}`;
}

function readToolbarPrefs(frm) {
	const key = toolbarPrefsKey(frm);
	if (!key || typeof window === "undefined" || !window.localStorage) {
		return null;
	}
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) {
			return null;
		}
		const obj = JSON.parse(raw);
		return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
	} catch (_err) {
		return null;
	}
}

function persistToolbarPrefs(frm) {
	const key = toolbarPrefsKey(frm);
	if (!key || typeof window === "undefined" || !window.localStorage) {
		return;
	}
	try {
		window.localStorage.setItem(
			key,
			JSON.stringify({
				period_type: frm._pl_period_type || "month",
				view: viewKeyByLabel(frm.budget_view_options),
				hide_plan: !!frm.bg_hide_plan,
				hide_delta: !!frm.bg_hide_delta,
				delta_mode: frm.bg_delta_mode === "abs" ? "abs" : "pct",
				accumulated_values: !!frm.bg_accumulated_values,
				show_zero_rows: !!frm.bg_show_zero_rows,
			})
		);
	} catch (_err) {
		// quota / privacy mode
	}
}

function applyToolbarPrefs(frm) {
	const prefs = readToolbarPrefs(frm);
	if (!prefs) {
		return;
	}
	if (PERIOD_TYPES.includes(prefs.period_type)) {
		frm._pl_period_type = prefs.period_type;
	}
	if (prefs.view === "forecast_actual" || prefs.view === "forecast_only" || prefs.view === "actual_only") {
		frm.budget_view_options = viewLabelByKey(prefs.view);
	}
	if (typeof prefs.hide_plan === "boolean") {
		frm.bg_hide_plan = prefs.hide_plan;
	}
	if (typeof prefs.hide_delta === "boolean") {
		frm.bg_hide_delta = prefs.hide_delta;
	}
	if (prefs.delta_mode === "abs" || prefs.delta_mode === "pct") {
		frm.bg_delta_mode = prefs.delta_mode;
	}
	if (typeof prefs.accumulated_values === "boolean") {
		frm.bg_accumulated_values = prefs.accumulated_values;
	}
	if (typeof prefs.show_zero_rows === "boolean") {
		frm.bg_show_zero_rows = prefs.show_zero_rows;
	}
}

function ensurePlDefaults(frm) {
	if (!frm._pl_toolbar_prefs_applied) {
		applyToolbarPrefs(frm);
		frm._pl_toolbar_prefs_applied = true;
	}
	if (frm.bg_hide_plan === undefined) {
		frm.bg_hide_plan = true;
	}
	if (frm.bg_hide_delta === undefined) {
		frm.bg_hide_delta = true;
	}
	if (frm.bg_delta_mode !== "abs") {
		frm.bg_delta_mode = "pct";
	}
	if (frm.bg_accumulated_values === undefined) {
		frm.bg_accumulated_values = false;
	}
	if (frm.bg_show_zero_rows === undefined) {
		frm.bg_show_zero_rows = true;
	}
	if (!frm._pl_period_type) {
		frm._pl_period_type = "month";
	}
	frm.budget_view_options = frm.budget_view_options || __("Forecast and actual");
}

function addPeriodTypeControl(frm, host) {
	const labelByValue = {
		month: __("Month"),
		quarter: __("Quarter"),
		year: __("Year"),
	};
	const valueByLabel = {
		[__("Month")]: "month",
		[__("Quarter")]: "quarter",
		[__("Year")]: "year",
		Month: "month",
		Quarter: "quarter",
		Year: "year",
	};
	frappe.ui.form.make_control({
		parent: host,
		df: {
			fieldtype: "Select",
			fieldname: "period-type",
			options: [__("Month"), __("Quarter"), __("Year")],
			get_status: () => "Write",
			change: function () {
				if (this.value === this.last_value) {
					return;
				}
				frm._pl_period_type = valueByLabel[this.value] || "month";
				persistToolbarPrefs(frm);
				window.ProjectBudget?.onPeriodOrAggregateChange(frm);
			},
		},
		value: labelByValue[frm._pl_period_type] || __("Month"),
		only_input: true,
		render_input: true,
	});
}

function addViewOptionsControl(frm, host) {
	frappe.ui.form.make_control({
		parent: host,
		df: {
			fieldtype: "Select",
			fieldname: "view-options",
			options: [__("Forecast and actual"), __("Forecast only"), __("Actual only")],
			get_status: function () {
				return "Write";
			},
			change: function () {
				if (this.value == this.last_value) {
					return;
				}
				frm.budget_view_options = this.value;
				persistToolbarPrefs(frm);
				window.ProjectBudget?.onViewOptionsChange(frm);
			},
		},
		value: frm.budget_view_options,
		only_input: true,
		render_input: true,
	});
}

function syncDeltaModeSegment(host, frm) {
	const hidden = !!frm.bg_hide_delta;
	const mode = normalizeDeltaMode(frm.bg_delta_mode);
	const $slot = host.find(".pl-delta-mode-slot");
	const $mode = host.find(".pl-delta-mode");
	if (!$slot.data("ready")) {
		$slot.addClass("no-anim");
	}
	$slot.toggleClass("is-open", !hidden);
	$slot.attr("aria-hidden", hidden ? "true" : "false");
	$mode.find(".pl-delta-mode-btn").each(function () {
		const btn = $(this);
		const active = btn.attr("data-mode") === mode;
		btn.prop("disabled", hidden);
		btn.toggleClass("is-active", active);
		btn.attr("aria-pressed", active ? "true" : "false");
	});
	if (!$slot.data("ready")) {
		requestAnimationFrame(() => {
			$slot.removeClass("no-anim");
			$slot.data("ready", true);
		});
	}
}

function addDeltaModeSegment($parent, frm, $syncRoot) {
	const $slot = $(`
		<div class="pl-delta-mode-slot" aria-hidden="true">
			<div class="pl-delta-mode-slot-inner">
				<div class="pl-delta-mode" role="group" aria-label="${__("Delta format")}">
					<button type="button" class="pl-delta-mode-btn" data-mode="pct" aria-pressed="false">%</button>
					<button type="button" class="pl-delta-mode-btn" data-mode="abs" aria-pressed="false">${__("abs")}</button>
				</div>
			</div>
		</div>
	`);
	$slot.on("click", ".pl-delta-mode-btn", function () {
		if (!$slot.hasClass("is-open") || this.disabled) {
			return;
		}
		frm.bg_delta_mode = normalizeDeltaMode(this.getAttribute("data-mode"));
		persistToolbarPrefs(frm);
		syncDeltaModeSegment($syncRoot, frm);
		window.ProjectBudget?.onTogglePlanOrDelta(frm);
	});
	$slot.appendTo($parent);
	return $slot;
}

function addToolbarCheckbox(host, opts) {
	const wrapper = $('<div class="pl-toolbar-checkbox-wrapper"></div>').appendTo(host);
	const control = frappe.ui.form.make_control({
		parent: wrapper,
		df: {
			fieldtype: "Check",
			fieldname: opts.fieldname,
			label: opts.label,
			get_status: () => "Write",
			onchange: opts.onchange,
		},
		value: opts.value,
		only_input: false,
		render_input: true,
	});
	control.refresh();
	return control;
}

function checkboxOn(control) {
	if (typeof control?.get_input_value === "function") {
		return !!cint(control.get_input_value());
	}
	return !!control?.get_value?.();
}

function refreshChart(frm) {
	if (typeof dinext_projects_pl?.renderPlChart === "function") {
		dinext_projects_pl.renderPlChart(frm);
		return;
	}
	window.ProjectBudget?.refreshChart?.(frm);
}

/** Accumulated view is derived display — no writes that persist to server. */
export function isMutationLocked(frm) {
	return !!frm?.bg_accumulated_values;
}

function mutationLockTitle() {
	return __("Not available in accumulated values mode");
}

function applyMutationLock(frm, host) {
	if (!host?.length) {
		return;
	}
	const locked = isMutationLocked(frm);
	const $forecastBtn = host.find(".pl-forecast-dropdown-wrapper .btn");
	const $saveBtn = host.find("#bg-save_plan");
	$forecastBtn.prop("disabled", locked);
	$saveBtn.prop("disabled", locked);
	if (locked) {
		$forecastBtn.attr("title", mutationLockTitle());
		$saveBtn.attr("title", mutationLockTitle());
	} else {
		$forecastBtn.attr("title", __("Add forecast"));
		$saveBtn.attr("title", __("Save plan"));
	}
}

function findForecastToolbarHost(frm) {
	const fromState = $(frm.project_budget?.container)
		.find(".dinext-table-toolbar-custom.budget-controls")
		.first();
	if (fromState.length && document.body.contains(fromState.get(0))) {
		return fromState;
	}
	const $wrap = frm.$wrapper || $(frm.wrapper);
	return $wrap
		.find(".budget-container .dinext-table-toolbar-custom.budget-controls")
		.first();
}

/** Insert after period select (3rd slot). Fallback: append. */
function placeForecastDropdown(host, $wrapper) {
	const $period = host.find('.frappe-control[data-fieldname="period-type"]').first();
	if ($period.length) {
		$wrapper.insertAfter($period);
	} else {
		host.append($wrapper);
	}
}

function addForecastDropdown(frm, host) {
	const items = getForecastMenuItems(frm);
	host.find(".pl-forecast-dropdown-wrapper").remove();
	if (!items.length) {
		return;
	}

	const $wrapper = $('<div class="pl-forecast-dropdown-wrapper dropdown"></div>');
	const $btn = $(`
		<button class="btn btn-default dropdown-toggle" type="button" aria-haspopup="true" aria-expanded="false"
			title="${__("Add forecast")}" aria-label="${__("Add forecast")}">
			<span class="pl-forecast-plus" aria-hidden="true">+</span>
			<span>${__("Forecast")}</span>
		</button>
	`);
	const $menu = $('<ul class="dropdown-menu dropdown-menu-right" role="menu"></ul>');

	items.forEach((item) => {
		const $li = $('<li role="presentation"></li>');
		const $a = $(`<a class="dropdown-item" href="#" role="menuitem">${item.label}</a>`);
		$a.on("click", function (e) {
			e.preventDefault();
			if (isMutationLocked(frm)) {
				return;
			}
			item.action(frm);
			closeForecastMenu($wrapper, $btn, $menu);
		});
		$li.append($a);
		$menu.append($li);
	});

	$wrapper.append($btn).append($menu);
	placeForecastDropdown(host, $wrapper);
	bindDropdownPortal($wrapper, $btn, $menu);
	applyMutationLock(frm, host);
}

function closeForecastMenu($wrapper, $btn, $menu) {
	if ($menu.parent()[0] !== $wrapper[0]) {
		$menu
			.hide()
			.removeClass("pl-toolbar-forecast-menu")
			.appendTo($wrapper)
			.css({
				display: "",
				position: "",
				top: "",
				left: "",
				right: "",
				width: "",
				zIndex: "",
			});
	}
	$btn.attr("aria-expanded", "false");
}

function bindDropdownPortal($wrapper, $btn, $menu) {
	const isPortaled = () => !$menu.parent().is($wrapper);

	const closeMenu = () => {
		if (!isPortaled()) {
			return;
		}
		closeForecastMenu($wrapper, $btn, $menu);
		document.removeEventListener("mousedown", onDocDown, true);
		window.removeEventListener("resize", closeMenu);
		window.removeEventListener("scroll", closeMenu, true);
	};

	const onDocDown = (event) => {
		if ($menu[0].contains(event.target) || $btn[0].contains(event.target)) {
			return;
		}
		closeMenu();
	};

	const openMenu = () => {
		const rect = $btn[0].getBoundingClientRect();
		$menu
			.appendTo(get_portal_host())
			.addClass("pl-toolbar-forecast-menu")
			.css({
				display: "block",
				position: "fixed",
				top: rect.bottom + 2,
				right: "auto",
				width: "max-content",
				zIndex: 1050,
			});
		const menuWidth = $menu.outerWidth() || 220;
		let left = rect.right - menuWidth;
		if (left < 8) {
			left = 8;
		}
		$menu.css({ left });
		$btn.attr("aria-expanded", "true");
		setTimeout(() => {
			document.addEventListener("mousedown", onDocDown, true);
			window.addEventListener("resize", closeMenu);
			window.addEventListener("scroll", closeMenu, true);
		}, 0);
	};

	$btn.on("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (isPortaled() && $menu.is(":visible")) {
			closeMenu();
			return;
		}
		openMenu();
	});
}

/**
 * Mount domain controls into DinextTable toolbar custom host (once).
 * Order: view → period → Add forecast → Save plan →
 * Plan → Δ [%|абс] → Empty rows → Accumulated Values.
 */
export function mount_toolbar_controls(frm, host) {
	if (host.data("pl-controls-mounted")) {
		addForecastDropdown(frm, host);
		syncDeltaModeSegment(host, frm);
		return;
	}
	host.data("pl-controls-mounted", true);
	host.addClass("budget-controls");
	ensurePlDefaults(frm);

	addViewOptionsControl(frm, host);
	addPeriodTypeControl(frm, host);
	addForecastDropdown(frm, host);

	host.append(`
		<button class="btn btn-default pl-save-plan-btn" id="bg-save_plan" type="button"
			title="${__("Save plan")}" aria-label="${__("Save plan")}">
			<i class="fa fa-save" aria-hidden="true"></i>
			<span class="pl-save-plan-label">${__("Plan")}</span>
		</button>
	`);

	addToolbarCheckbox(host, {
		fieldname: "show_plan",
		label: __("Plan"),
		value: !frm.bg_hide_plan,
		onchange: function () {
			frm.bg_hide_plan = !checkboxOn(this);
			persistToolbarPrefs(frm);
			window.ProjectBudget?.onTogglePlanOrDelta(frm);
			refreshChart(frm);
		},
	});

	const $delta = $('<div class="pl-delta-group"></div>').appendTo(host);
	addToolbarCheckbox($delta, {
		fieldname: "show_delta",
		label: __("Δ"),
		value: !frm.bg_hide_delta,
		onchange: function () {
			frm.bg_hide_delta = !checkboxOn(this);
			persistToolbarPrefs(frm);
			syncDeltaModeSegment(host, frm);
			window.ProjectBudget?.onTogglePlanOrDelta(frm);
		},
	});
	addDeltaModeSegment($delta, frm, host);
	syncDeltaModeSegment(host, frm);

	addToolbarCheckbox(host, {
		fieldname: "show_zero_rows",
		label: __("Empty rows"),
		value: !!frm.bg_show_zero_rows,
		onchange: function () {
			frm.bg_show_zero_rows = checkboxOn(this);
			persistToolbarPrefs(frm);
			window.ProjectBudget?.onPeriodOrAggregateChange(frm);
		},
	});

	addToolbarCheckbox(host, {
		fieldname: "accumulated_values",
		label: __("Accumulated Values"),
		value: !!frm.bg_accumulated_values,
		onchange: function () {
			frm.bg_accumulated_values = checkboxOn(this);
			persistToolbarPrefs(frm);
			applyMutationLock(frm, host);
			window.ProjectBudget?.onPeriodOrAggregateChange(frm);
		},
	});

	host.find("#bg-save_plan").on("click", function () {
		if (isMutationLocked(frm)) {
			return;
		}
		window.ProjectBudget?.saveForecastAsPlan(frm);
	});

	applyMutationLock(frm, host);

	// Registrars run on Project.refresh — paint from live host, not captured node.
	setTimeout(() => refreshForecastDropdown(frm), 0);
	setTimeout(() => refreshForecastDropdown(frm), 250);
	setTimeout(() => refreshForecastDropdown(frm), 800);
}

export function refreshForecastDropdown(frm) {
	const $host = findForecastToolbarHost(frm);
	if (!$host.length) {
		return;
	}
	addForecastDropdown(frm, $host);
	applyMutationLock(frm, $host);
}

function get_portal_host() {
	return (
		document.fullscreenElement ||
		document.webkitFullscreenElement ||
		document.mozFullScreenElement ||
		document.msFullscreenElement ||
		document.body
	);
}

const OVERLAY_SELECTOR =
	"#freeze, #dialog-container, .modal, .modal-backdrop, .frappe-toast-area, .awesomplete > ul";

let _overlayWatchObserver = null;
let _overlayWatchRaf = null;

function bring_overlays_into_fullscreen(selector) {
	const host = get_portal_host();
	if (!host || host === document.body) {
		return;
	}
	const $nodes = selector ? $(selector) : $(OVERLAY_SELECTOR);
	$nodes.each(function () {
		if (!this || !this.parentNode) {
			return;
		}
		if (host.contains(this) && this.parentNode === host) {
			return;
		}
		const modalRoot = this.classList?.contains("modal") ? this : this.closest?.(".modal");
		const node = modalRoot && modalRoot !== host ? modalRoot : this;
		if (node.parentNode !== host) {
			host.appendChild(node);
		}
		if (node.classList?.contains("modal")) {
			node.style.zIndex = "10050";
		}
		if (node.classList?.contains("modal-backdrop")) {
			node.style.zIndex = "10040";
		}
	});
}

function start_fullscreen_overlay_watch() {
	stop_fullscreen_overlay_watch();
	bring_overlays_into_fullscreen();
	const schedule = () => {
		if (_overlayWatchRaf) {
			cancelAnimationFrame(_overlayWatchRaf);
		}
		_overlayWatchRaf = requestAnimationFrame(() => {
			_overlayWatchRaf = null;
			bring_overlays_into_fullscreen();
		});
	};
	_overlayWatchObserver = new MutationObserver(schedule);
	_overlayWatchObserver.observe(document.body, { childList: true, subtree: true });
	[0, 50, 150, 300].forEach((ms) => setTimeout(bring_overlays_into_fullscreen, ms));
}

function stop_fullscreen_overlay_watch() {
	if (_overlayWatchObserver) {
		_overlayWatchObserver.disconnect();
		_overlayWatchObserver = null;
	}
	if (_overlayWatchRaf) {
		cancelAnimationFrame(_overlayWatchRaf);
		_overlayWatchRaf = null;
	}
}

export {
	bring_overlays_into_fullscreen,
	ensurePlDefaults,
	get_portal_host,
	start_fullscreen_overlay_watch,
	stop_fullscreen_overlay_watch,
};
