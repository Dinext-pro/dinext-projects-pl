import { getFieldTab } from "./lazy-tab-mount.js";

const BANNER_CLASS = "pl-access-banner";
const BANNER_STYLE_ID = "pl-access-banner-style";

function ensureBannerStyle() {
	if (document.getElementById(BANNER_STYLE_ID)) {
		return;
	}
	const style = document.createElement("style");
	style.id = BANNER_STYLE_ID;
	style.textContent = `
#project-custom_pl:has(> .${BANNER_CLASS}) {
	min-height: 240px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.${BANNER_CLASS} {
	margin: 0;
	padding: 24px 16px;
	border: none !important;
	border-radius: 0;
	background: transparent !important;
	box-shadow: none !important;
	text-align: center;
	font-size: calc(var(--text-base, 14px) * 1.5);
	line-height: 1.4;
	color: var(--text-muted, #6b7280);
	width: 100%;
}
[data-theme="dark"] .${BANNER_CLASS} {
	color: var(--text-muted, #9ca3af);
}
`;
	document.head.appendChild(style);
}

export function flagOn(value) {
	return value === true || value === 1 || value === "1";
}

export function hasPlAmountAccess(state) {
	if (!state) {
		return true;
	}
	if ("can_read_project_budget" in state || "can_read_gl_entry" in state) {
		return flagOn(state.can_read_project_budget) || flagOn(state.can_read_gl_entry);
	}
	return true;
}

function getPlTabPane(frm) {
	const tab =
		getFieldTab(frm, "custom_planning") || getFieldTab(frm, "custom_pl");
	if (tab?.wrapper?.length) {
		return tab.wrapper;
	}
	return $(frm?.$wrapper).find("#project-custom_pl");
}

export function syncPlAccessBanner(frm) {
	const $pane = getPlTabPane(frm);
	if (!$pane?.length) {
		return;
	}

	const denied = !hasPlAmountAccess(frm.project_budget);
	let $banner = $pane.children(`.${BANNER_CLASS}`);
	if (denied) {
		ensureBannerStyle();
		if (!$banner.length) {
			$banner = $(`<div class="${BANNER_CLASS}" role="status"></div>`);
			$banner.text(__("Insufficient permissions"));
			$pane.prepend($banner);
		}
		$pane.find(".form-section").hide();
		return;
	}

	$banner.remove();
	$pane.find(".form-section").show();
}
