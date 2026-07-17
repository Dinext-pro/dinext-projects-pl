/** Lazy-tab helpers (mirror of PWA core/lazy-tab-mount.js) for project-budget.bundle. */

export function getFieldTab(frm, fieldname) {
	const field = frm?.get_field?.(fieldname);
	if (!field) {
		return null;
	}
	if (field.tab) {
		return field.tab;
	}
	const node = field.$wrapper?.get?.(0);
	const tabs = frm.layout?.tabs;
	if (!node || !tabs?.length) {
		return null;
	}
	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];
		const pane = tab.wrapper?.get?.(0);
		if (pane && $.contains(pane, node)) {
			return tab;
		}
	}
	return null;
}

export function isFieldTabVisible(frm, fieldname) {
	const tab = getFieldTab(frm, fieldname);
	if (!tab) {
		return false;
	}
	return typeof tab.is_active === "function"
		? tab.is_active()
		: !!tab.wrapper?.hasClass?.("active");
}

export function bindLazyTabMount(frm, fieldname, mountFn) {
	if (!frm || !fieldname || typeof mountFn !== "function") {
		return;
	}

	const bindKey = `_pwaLazyMount_${fieldname}`;

	const attach = () => {
		const tab = getFieldTab(frm, fieldname);
		if (!tab) {
			return false;
		}

		const $link = tab.tab_link?.find?.(".nav-link");
		if ($link?.length && !frm[bindKey]) {
			frm[bindKey] = true;
			$link.on("shown.bs.tab", function () {
				mountFn();
			});
		}

		if (isFieldTabVisible(frm, fieldname)) {
			mountFn();
		}
		return true;
	};

	if (attach()) {
		return;
	}

	setTimeout(() => {
		attach();
	}, 0);
}

export function installLazyTabMountApi() {
	frappe.provide("project_workload_assignment");
	const api = project_workload_assignment;
	api.getFieldTab = getFieldTab;
	api.isFieldTabVisible = isFieldTabVisible;
	api.bindLazyTabMount = bindLazyTabMount;
}
