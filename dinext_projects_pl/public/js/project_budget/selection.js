const SAVE_PLAN_API =
	"dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval";

/** Selected body rows (rowCheck), exclude summary / non-account. */
export function getSelectedRows(frm) {
	const table = frm.project_budget?.table;
	if (!table?.getCheckedRows) {
		return [];
	}
	return table
		.getCheckedRows()
		.filter((row) => row && !row.summary_kind && row.account);
}

/**
 * Legacy-shaped payload for save_budget_plan_for_approval.
 * Past → own_fact (not rolled fact_*); future → forecast.
 */
export function buildSavePlanPayload(frm) {
	const selected = getSelectedRows(frm);
	const periods = frm.project_budget?.periods || [];
	const data = [];

	for (const row of selected) {
		const amounts = [];
		for (const period of periods) {
			const key = period.key;
			const planValue = period.is_past
				? Number(row[`own_fact_${key}`] ?? 0)
				: Number(row[`forecast_${key}`] ?? 0);
			if (planValue > 0) {
				amounts.push({
					year: period.year,
					month: period.month,
					plan_value: planValue,
				});
			}
		}
		if (!amounts.length) continue;
		data.push({
			account: row.account,
			dimensions: row.dimensions || [],
			amounts,
		});
	}

	return data;
}

async function executeSavePlan(frm, data) {
	const res = await frappe.xcall(SAVE_PLAN_API, {
		project: frm.doc.name,
		data: JSON.stringify(data),
	});
	if (res?.exc) {
		throw new Error(res.exc);
	}

	const mode = res?.mode || "approval";
	const successMessage =
		mode === "direct"
			? __("Plan saved")
			: __("Budgets submitted for approval");

	frappe.show_alert(successMessage, 5);

	if (typeof load_and_render_project_dashboard === "function") {
		load_and_render_project_dashboard(frm);
	}
	if (window.ProjectBudget?.refresh) {
		await window.ProjectBudget.refresh(frm);
	}
}

/**
 * Save plan for selected v2 rows. Confirm once, then save.
 */
export function saveForecastAsPlan(frm) {
	if ((frm._pl_period_type || "month") !== "month") {
		frappe.msgprint(
			__("Saving plan is available only in monthly display mode.")
		);
		return;
	}

	const v2Selected = getSelectedRows(frm);

	if (!v2Selected.length) {
		frappe.msgprint(
			__("Select the rows for which plan data should be saved.")
		);
		return;
	}

	const data = buildSavePlanPayload(frm);
	if (!data.length) {
		frappe.msgprint(__("No data to save."));
		return;
	}

	frappe.confirm(
		__("Are you sure you want to save the current forecast / actual data as plan?"
		),
		() => {
			executeSavePlan(frm, data).catch((err) => {
				frappe.msgprint(__("Error saving plan"));
				console.error(err);
			});
		},
		() => frappe.show_alert(__("Operation cancelled"), 3)
	);
}
