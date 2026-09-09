/** Delete risk reserve: drop Project Budget with Project Risk dimension. Same as prod P&L. */

export function canDeleteRiskReserve(row) {
	return Boolean(row?.risk && row.pb_docname);
}

export function accountLabelTreeContentKey(params) {
	const row = params?.data || {};
	return `${row.risk || ""}\0${row.pb_docname || ""}`;
}

function closeIconHtml() {
	return (
		'<span class="filter-icon">' +
		'<svg class="es-icon es-line icon-sm" aria-hidden="true">' +
		'<use href="#es-small-close"></use></svg></span>'
	);
}

export function confirmDeleteRiskReserve(frm, pbName) {
	if (!pbName) return;
	frappe.confirm(
		__("Delete risk reserves?"),
		() => {
			frappe.call({
				method: "frappe.client.delete",
				args: { doctype: "Project Budget", name: pbName },
				freeze: true,
				callback(r) {
					if (!r.exc && frm) {
						frappe.show_alert(
							{ message: __("Data deleted"), indicator: "green" },
							5
						);
						window.ProjectBudget?.refresh?.(frm);
					}
					if (r.exc) {
						frappe.msgprint(__("Error deleting risk reserve"));
					}
				},
			});
		},
		() => {
			frappe.show_alert(__("Operation cancelled"), 3);
		}
	);
}

/** Tree col body: label + optional close button on risk reserve rows. */
export function renderAccountLabel(params, frm) {
	const row = params?.data || {};
	const wrap = document.createElement("span");
	wrap.className = "project-budget-account-label";

	const text = document.createElement("span");
	if (row.risk) {
		text.className = "risk-label";
	}
	text.textContent = String(params?.value ?? row.account_label ?? "");
	wrap.appendChild(text);

	if (!canDeleteRiskReserve(row) || frm?.bg_accumulated_values) {
		return wrap;
	}

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className =
		"btn delete-risk-reserve-btn btn-default btn-sm filter-x-button";
	btn.title = __("Delete risk reserves");
	btn.dataset.pbName = row.pb_docname;
	btn.innerHTML = closeIconHtml();
	btn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		confirmDeleteRiskReserve(frm, row.pb_docname);
	});
	wrap.appendChild(btn);
	return wrap;
}
