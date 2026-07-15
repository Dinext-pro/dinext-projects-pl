// TEMPORARY — dual-table preview. Cutover: delete file; mount.js uses .budget-table.

const PREVIEW_SECTION_CLASS = "project-pl-v2-section";
const PREVIEW_TABLE_CLASS = "budget-table-v2";

export function isPreviewEnabled(frm) {
	if (frm._pl_v2_enabled === undefined) {
		frm._pl_v2_enabled = true;
	}
	return frm._pl_v2_enabled !== false;
}

export function resolvePreviewContainer(frm, wrapper) {
	if (!isPreviewEnabled(frm)) {
		return null;
	}

	let section = wrapper.find(`.${PREVIEW_SECTION_CLASS}`);
	if (!section.length) {
		section = $(`
			<div class="${PREVIEW_SECTION_CLASS}">
				<div class="project-pl-v2-header">
					<span class="project-pl-v2-badge">${__("P&L v2 (preview)")}</span>
				</div>
				<div class="${PREVIEW_TABLE_CLASS}"></div>
			</div>
		`);
		const legacyTable = wrapper.find(".budget-table");
		if (legacyTable.length) {
			legacyTable.after(section);
		} else {
			wrapper.append(section);
		}
	}

	const containerEl = section.find(`.${PREVIEW_TABLE_CLASS}`)[0];
	if (containerEl) {
		containerEl.style.height = "min(50vh, 560px)";
		containerEl.style.minHeight = "280px";
	}
	return containerEl || null;
}
