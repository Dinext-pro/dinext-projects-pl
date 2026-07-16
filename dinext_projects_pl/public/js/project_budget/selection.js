function flattenTree(rows) {
	const result = [];
	for (const row of rows || []) {
		result.push(row);
		if (row.children?.length) {
			result.push(...flattenTree(row.children));
		}
	}
	return result;
}

const SAVE_PLAN_API =
	"dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval";

/** Selected body rows (checkbox), exclude summary. */
export function getSelectedRows(frm) {
	return flattenTree(frm.project_budget?.rows || []).filter(
		(row) => row._selected && !row.summary_kind && row.account
	);
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
			? __("План сохранен")
			: __("Бюджеты отправлены на согласование");

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
	const v2Selected = getSelectedRows(frm);

	if (!v2Selected.length) {
		frappe.msgprint(
			__("Выберите строки, для которых необходимо сохранить плановые данные.")
		);
		return;
	}

	const data = buildSavePlanPayload(frm);
	if (!data.length) {
		frappe.msgprint(__("Нет данных для сохранения."));
		return;
	}

	frappe.confirm(
		__(
			"Вы уверены, что хотите сохранить текущие прогнозные / фактические данные как плановые?"
		),
		() => {
			executeSavePlan(frm, data).catch((err) => {
				frappe.msgprint(__("Ошибка при сохранении плана"));
				console.error(err);
			});
		},
		() => frappe.show_alert(__("Операция отменена"), 3)
	);
}
