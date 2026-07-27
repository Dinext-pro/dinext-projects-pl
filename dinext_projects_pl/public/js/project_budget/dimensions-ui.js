import { ADD_DIMENSION_API, DIM_OPTIONS_API, MERGE_GROUP } from "./constants.js";

let openMenuEl = null;
let openMenuCloser = null;

function stopGridEvent(e) {
	e.stopPropagation();
}

function closeAddDimMenu() {
	if (openMenuCloser) {
		document.removeEventListener("mousedown", openMenuCloser, true);
		openMenuCloser = null;
	}
	if (openMenuEl) {
		openMenuEl.remove();
		openMenuEl = null;
	}
}

function isMergeHead(row) {
	const index = row?.[MERGE_GROUP.indexField];
	return index == null || index === 0;
}

async function loadDimOptions(frm, account) {
	return frappe.xcall(DIM_OPTIONS_API, {
		project: frm.doc.name,
		account,
	});
}

async function addDimension(frm, row, dimDoc, dimDocname, mode) {
	const res = await frappe.xcall(ADD_DIMENSION_API, {
		project: frm.doc.name,
		account: row.account,
		dim_doc: dimDoc,
		dim_docname: dimDocname,
		mode: mode || "new",
		pb_docname: row.pb_docname || "",
		base_dimensions: JSON.stringify(row.dimensions || []),
	});
	const msg =
		mode === "existing"
			? __("Измерение добавлено в запись")
			: res?.created
				? __("Создана строка бюджета с измерением")
				: __("Строка бюджета с измерением уже существует");
	frappe.show_alert({ message: msg, indicator: "green" }, 3);
	frm.bg_show_dimensions = true;
	await window.ProjectBudget?.refresh?.(frm);
}

function pickValueThenAdd(frm, row, dimType, mode) {
	const options = dimType.options || [];
	if (!options.length) {
		frappe.msgprint(__("Нет доступных значений для {0}", [dimType.label || dimType.document_type]));
		return;
	}

	const d = new frappe.ui.Dialog({
		title: __("Добавить измерение: {0}", [dimType.label || dimType.document_type]),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "docname",
				label: __("Значение"),
				options: options.map((o) => o.value).join("\n"),
				reqd: 1,
			},
		],
		primary_action_label: __("Добавить"),
		primary_action: (values) => {
			d.hide();
			addDimension(frm, row, dimType.document_type, values.docname, mode).catch((err) => {
				console.error(err);
				frappe.msgprint(__("Ошибка при добавлении измерения"));
			});
		},
	});
	d.show();
}

function openAddDimMenu(frm, row, anchorEl, payload) {
	closeAddDimMenu();
	const dimensions = (payload?.dimensions || []).filter((d) => (d.options || []).length);
	if (!dimensions.length) {
		frappe.msgprint(__("Для этого счёта нет доступных измерений (Accounting Dimension Filter)"));
		return;
	}

	const menu = document.createElement("div");
	menu.className = "dropdown-menu pl-dim-add-menu show";
	menu.style.position = "fixed";
	menu.style.zIndex = "1051";
	menu.style.display = "block";
	menu.style.minWidth = "220px";

	const addSection = (title, mode) => {
		const head = document.createElement("div");
		head.className = "dropdown-header";
		head.textContent = title;
		menu.appendChild(head);
		for (const dimType of dimensions) {
			const item = document.createElement("button");
			item.type = "button";
			item.className = "dropdown-item";
			item.textContent = dimType.label || dimType.document_type;
			item.addEventListener("mousedown", stopGridEvent);
			item.addEventListener("click", (e) => {
				e.stopPropagation();
				closeAddDimMenu();
				pickValueThenAdd(frm, row, dimType, mode);
			});
			menu.appendChild(item);
		}
	};

	addSection(__("Новая строка по счёту"), "new");
	if (row.pb_docname) {
		menu.appendChild(document.createElement("div")).className = "dropdown-divider";
		addSection(__("В текущую запись"), "existing");
	}

	document.body.appendChild(menu);
	openMenuEl = menu;

	const rect = anchorEl.getBoundingClientRect();
	const top = Math.min(rect.bottom + 2, window.innerHeight - menu.offsetHeight - 8);
	const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
	menu.style.top = `${Math.max(8, top)}px`;
	menu.style.left = `${Math.max(8, left)}px`;

	openMenuCloser = (event) => {
		if (menu.contains(event.target) || anchorEl.contains(event.target)) {
			return;
		}
		closeAddDimMenu();
	};
	document.addEventListener("mousedown", openMenuCloser, true);
}

function buildAddDimControl(frm, row) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "btn btn-default btn-xs pl-dim-add";
	btn.title = __("Добавить измерение");
	btn.setAttribute("aria-label", __("Добавить измерение"));
	btn.textContent = "+";

	btn.addEventListener("mousedown", stopGridEvent);
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		if (openMenuEl) {
			closeAddDimMenu();
			return;
		}
		loadDimOptions(frm, row.account)
			.then((payload) => openAddDimMenu(frm, row, btn, payload))
			.catch((err) => {
				console.error(err);
				frappe.msgprint(__("Не удалось загрузить список измерений"));
			});
	});

	return btn;
}

/** Cell renderer for Dimension column (+ on merge head). */
export function dimensionCellRenderer(frm) {
	return function (params) {
		const row = params.data;
		const wrap = document.createElement("div");
		wrap.className = "pl-dim-cell";

		if (!row || row.summary_kind) {
			return wrap;
		}

		const label = document.createElement("span");
		label.className = "pl-dim-label";
		const raw = row.dimension_label || "";
		label.textContent = raw === "—" ? "" : raw;
		wrap.appendChild(label);

		if (frm?.bg_show_dimensions && row.account && isMergeHead(row) && !row.risk) {
			const add = buildAddDimControl(frm, row);
			wrap.appendChild(add);
		}

		return wrap;
	};
}
