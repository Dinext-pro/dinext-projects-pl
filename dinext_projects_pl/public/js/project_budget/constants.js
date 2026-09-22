export const GRID_API =
	"dinext_projects_pl.api.get_project_budget_grid";

export const SAVE_FORECAST_API =
	"dinext_projects_pl.api.save_project_budget_forecast";

export const SAVE_PLAN_API =
	"dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval";

export const FIND_APPROVED_BUDGET_API =
	"dinext_projects_pl.dinext_projects_pl.budget_approval.service.find_approved_budget_for_period";

/** Auto-height cap (DinextTable `layout.maxHeight`) — same as Work Efforts. */
export const TABLE_MAX_HEIGHT = "min(60vh, 672px)";

/** Period leaf fields; `plan_total` → key `total` (not in period map). */
export const PERIOD_FIELD_RE = /^(plan|forecast|fact|actual|delta|own_fact|own_plan|own_forecast)_/;
