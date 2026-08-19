export const GRID_API =
	"dinext_projects_pl.api.get_project_budget_grid";

export const SAVE_FORECAST_API =
	"dinext_projects_pl.api.save_project_budget_forecast";

export const DIM_OPTIONS_API =
	"dinext_projects_pl.api.get_account_dimension_options";

export const ADD_DIMENSION_API =
	"dinext_projects_pl.api.add_project_budget_dimension";

export const SAVE_PLAN_API =
	"dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval";

/** Period leaf fields; `plan_total` → key `total` (not in period map). */
export const PERIOD_FIELD_RE = /^(plan|forecast|fact|actual|delta|own_fact)_/;

/** Matches DinextTable mergeGroup field names (WE-style). */
export const MERGE_GROUP = {
	idField: "merge_group_id",
	indexField: "merge_group_index",
	sizeField: "merge_group_size",
};
