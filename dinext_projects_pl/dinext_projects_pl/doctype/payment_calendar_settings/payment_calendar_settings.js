frappe.ui.form.on("Payment Calendar Settings", {
	setup(frm) {
		frm.calendar_catalog_promise = frappe
			.xcall("dinext_projects_pl.liquidity.api.get_settings_catalog")
			.then((catalog) => {
				frm.calendar_catalog = catalog.sources;
				return catalog.sources;
			});
		return frm.calendar_catalog_promise;
	},
});

frappe.ui.form.on("Payment Calendar Source", {
	async form_render(frm, cdt, cdn) {
		await frm.calendar_catalog_promise;
		const row = locals[cdt][cdn];
		const choices = frm.calendar_catalog?.[row.source_doctype]?.dates || [];
		const gridRow = frm.fields_dict.sources.grid.grid_rows_by_docname[cdn];
		const statesControl = gridRow?.grid_form?.fields_dict.statuses;
		if (statesControl) {
			statesControl.df.formatter = (value) =>
				String(value || "")
					.split("\n")
					.filter(Boolean)
					.map((state) => frappe.utils.escape_html(__(state)))
					.join("<br>");
			statesControl.refresh_input();
		}
		for (const fieldname of ["date_field", "fallback_date_field"]) {
			const control = gridRow?.grid_form?.fields_dict[fieldname];
			if (!control) continue;
			control.df.options = [
				{ value: "", label: "" },
				...(fieldname === "fallback_date_field"
					? [
							{ value: "previous", label: __("Previous source date") },
							{ value: "undated", label: __("Without date") },
					  ]
					: []),
				...choices.filter(
					(option) =>
						fieldname !== "fallback_date_field" || option.value !== "payment_schedule"
				),
			];
			control.set_options();
			control.refresh_input();
		}
	},
	async source_doctype(frm, cdt, cdn) {
		await frm.calendar_catalog_promise;
		const row = locals[cdt][cdn];
		const choices = frm.calendar_catalog?.[row.source_doctype]?.dates || [];
		if (!choices.some((option) => option.value === row.date_field)) {
			frappe.model.set_value(cdt, cdn, "date_field", "");
		}
		if (
			!["previous", "undated", ...choices.map((option) => option.value)].includes(
				row.fallback_date_field
			)
		) {
			frappe.model.set_value(cdt, cdn, "fallback_date_field", "");
		}
		frappe.model.set_value(cdt, cdn, "statuses", "");
		frm.script_manager.trigger("form_render", cdt, cdn);
	},
	async edit_states(frm, cdt, cdn) {
		await frm.calendar_catalog_promise;
		const row = locals[cdt][cdn];
		const selected = new Set((row.statuses || "").split("\n"));
		const options = frm.calendar_catalog?.[row.source_doctype]?.statuses || [];
		const dialog = new frappe.ui.Dialog({
			title: __("Allowed business states"),
			fields: [
				{
					fieldname: "states",
					fieldtype: "MultiCheck",
					label: __("Allowed business states"),
					options: options.map((value) => ({
						value,
						label: __(value),
						checked: selected.has(value),
					})),
					description: __(
						"Empty selection accepts all business states. Cancelled documents are always excluded."
					),
				},
			],
			primary_action_label: __("Apply"),
			primary_action(values) {
				frappe.model.set_value(cdt, cdn, "statuses", (values.states || []).join("\n"));
				dialog.hide();
			},
		});
		dialog.show();
	},
});
