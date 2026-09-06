import {
	accountLabelTreeContentKey,
	renderAccountLabel,
} from "./risk-delete.js";

/** Legacy period group width: 210 − 70 per hidden plan − 50 per hidden Δ. */
const LEGACY_PERIOD_GROUP_WIDTH = 210;
const LEGACY_PLAN_SUBCOL_WIDTH = 70;
const LEGACY_DELTA_SUBCOL_WIDTH = 50;

const ALIGN_CENTER = "dinext-table-cell--align-center";
const HEADER_CENTER = "project-budget-header--center";
const CELL_ZERO = "project-budget-cell--zero";
const CELL_PROFIT_POS = "project-budget-cell--profit-pos";
const CELL_PROFIT_NEG = "project-budget-cell--profit-neg";

function periodLeafWidth(hidePlan, hideDelta) {
	let group = LEGACY_PERIOD_GROUP_WIDTH;
	if (hidePlan) group -= LEGACY_PLAN_SUBCOL_WIDTH;
	if (hideDelta) group -= LEGACY_DELTA_SUBCOL_WIDTH;
	const visible = 1 + (hidePlan ? 0 : 1) + (hideDelta ? 0 : 1);
	return Math.round(group / visible);
}

function toNumber(value) {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : null;
}

function isProfitabilityRow(data) {
	return data?.summary_kind === "profitability";
}

function isProfitRow(data) {
	return data?.summary_kind === "profit";
}

/** Legacy numberformat: integer + thin space; profitability = one decimal + %. */
function formatAmount(params) {
	const n = toNumber(params.value);
	if (n == null) return "";
	if (isProfitabilityRow(params.data)) {
		return `${n.toFixed(1)}%`;
	}
	return n
		.toFixed(0)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Legacy delta: one decimal + %. */
function formatDelta(params) {
	const n = toNumber(params.value);
	if (n == null) return "";
	if (n === 0) return "0%";
	return `${n.toFixed(1)}%`;
}

function isZeroValue(params) {
	const n = toNumber(params.value);
	return n != null && n === 0;
}

const AMOUNT_CELL_CLASS_RULES = {
	[CELL_ZERO]: isZeroValue,
	[CELL_PROFIT_POS]: (params) => {
		if (!isProfitRow(params.data)) return false;
		const n = toNumber(params.value);
		return n != null && n > 0;
	},
	[CELL_PROFIT_NEG]: (params) => {
		if (!isProfitRow(params.data)) return false;
		const n = toNumber(params.value);
		return n != null && n < 0;
	},
};

function fixedWidth(width) {
	return {
		width,
		minWidth: width,
		maxWidth: width,
		resizable: false,
		suppressSizeToFit: true,
	};
}

function mergeClassList(existing, next) {
	if (!existing) return next;
	if (typeof existing === "string") return `${existing} ${next}`;
	if (Array.isArray(existing)) return [...existing, next];
	return existing;
}

function withCenterAlign(col) {
	return {
		...col,
		cellClass: mergeClassList(col.cellClass, ALIGN_CENTER),
		headerClass: mergeClassList(col.headerClass, HEADER_CENTER),
	};
}

function withoutColumnFilter(col) {
	return { ...col, filterable: false };
}

/** Amount editor: digits + decimal; reject letters / negatives. Empty → 0. */
function plAmountValueParser(params) {
	const raw = params.newValue;
	if (raw == null || raw === "") {
		return 0;
	}
	if (typeof raw === "number") {
		if (!Number.isFinite(raw) || raw < 0) {
			return params.oldValue;
		}
		return raw;
	}
	const trimmed = String(raw).trim().replace(/\s/g, "");
	if (!trimmed) {
		return 0;
	}
	if (!/^\d+([.,]\d+)?$/.test(trimmed)) {
		return params.oldValue;
	}
	const normalized =
		trimmed.includes(",") && !trimmed.includes(".")
			? trimmed.replace(",", ".")
			: trimmed.replace(/,/g, "");
	const value = Number(normalized);
	if (!Number.isFinite(value) || value < 0) {
		return params.oldValue;
	}
	return value;
}

/** Serial over every tree row (DFS), like StickyDataTable rowIndex + 1. */
function buildRowSerialMap(rows) {
	const map = new Map();
	let serial = 0;

	function walk(list) {
		for (const row of list || []) {
			if (row?.id != null) {
				serial += 1;
				map.set(row.id, serial);
			}
			if (row.children?.length) {
				walk(row.children);
			}
		}
	}

	walk(rows);
	return map;
}

function serialValueGetter(params) {
	const data = params.data;
	if (!data?.id || data.summary_kind) return "";

	const sourceRows =
		params.context?.dinextTable?.sourceData ||
		params.context?.dinextTable?.options?.data ||
		[];
	const map = buildRowSerialMap(sourceRows);
	return map.get(data.id) ?? "";
}

function buildPeriodLeaf(opts) {
	const { field, colId, headerName, width, hide, valueFormatter, edit, pinned } = opts;
	const col = withoutColumnFilter(
		withCenterAlign({
			field,
			colId,
			headerName,
			...fixedWidth(width),
			sortable: false,
			suppressMovable: true,
			tree: false,
			type: "number",
			hide: !!hide,
			valueFormatter,
			cellClassRules: { ...AMOUNT_CELL_CLASS_RULES },
		})
	);
	if (edit !== undefined) {
		col.edit = edit;
		col.cellEditor = "agNumberCellEditor";
		col.cellEditorParams = {
			min: 0,
			allowedCharPattern: "\\d\\.,",
		};
		col.valueParser = plAmountValueParser;
	} else {
		col.edit = false;
	}
	if (pinned) {
		col.pinned = pinned;
	}
	return col;
}

function buildPeriodColumns(frm, periods) {
	const form = frm || {};
	const hidePlan = !!form.bg_hide_plan;
	const hideDelta = !!form.bg_hide_delta;
	const leafWidth = periodLeafWidth(hidePlan, hideDelta);

	const periodType = form._pl_period_type || "month";
	const canEditForecast = periodType === "month";

	return (periods || []).map((period) => {
		const key = period.key;
		const actualLabel = period.is_past ? __("Actual") : __("Forecast");
		const headerName =
			period.label ||
			(period.quarter
				? `Q${period.quarter} ${period.year}`
				: period.month
					? `${period.year}-${String(period.month).padStart(2, "0")}`
					: String(period.year));

		return {
			colId: `period_${key}`,
			headerName,
			headerClass: HEADER_CENTER,
			marryChildren: true,
			children: [
				buildPeriodLeaf({
					field: `plan_${key}`,
					colId: `plan_${key}`,
					headerName: __("Plan"),
					width: leafWidth,
					hide: hidePlan,
					valueFormatter: formatAmount,
				}),
				buildPeriodLeaf({
					field: `actual_${key}`,
					colId: `actual_${key}`,
					headerName: actualLabel,
					width: leafWidth,
					edit: (row) =>
						canEditForecast && !period.is_past && !row?.summary_kind,
					valueFormatter: formatAmount,
				}),
				buildPeriodLeaf({
					field: `delta_${key}`,
					colId: `delta_${key}`,
					headerName: "Δ",
					width: leafWidth,
					hide: hideDelta,
					valueFormatter: formatDelta,
				}),
			],
		};
	});
}

function buildTotalColumn(frm, periods) {
	const hidePlan = !!frm.bg_hide_plan;
	const hideDelta = !!frm.bg_hide_delta;
	const leafWidth = periodLeafWidth(hidePlan, hideDelta);
	const last = periods?.[periods.length - 1];
	const actualLabel = last?.is_past ? __("Actual") : __("Forecast");

	return {
		colId: "total",
		headerName: __("Total"),
		headerClass: HEADER_CENTER,
		marryChildren: true,
		pinned: "right",
		children: [
			buildPeriodLeaf({
				field: "plan_total",
				colId: "plan_total",
				headerName: __("Plan"),
				width: leafWidth,
				hide: hidePlan,
				pinned: "right",
				valueFormatter: formatAmount,
			}),
			buildPeriodLeaf({
				field: "actual_total",
				colId: "actual_total",
				headerName: actualLabel,
				width: leafWidth,
				pinned: "right",
				valueFormatter: formatAmount,
			}),
			buildPeriodLeaf({
				field: "delta_total",
				colId: "delta_total",
				headerName: "Δ",
				width: leafWidth,
				hide: hideDelta,
				pinned: "right",
				valueFormatter: formatDelta,
			}),
		],
	};
}

/** Column set: # + Статья + period groups + Итого. */
export function getColumns(frm, periods) {
	const form = frm || (typeof cur_frm !== "undefined" ? cur_frm : null);
	const periodList = periods || form?.project_budget?.periods || [];

	const baseColumns = [
		withoutColumnFilter(
			withCenterAlign({
				field: "account_serial",
				colId: "account_serial",
				// Legacy index header is blank.
				headerName: "",
				...fixedWidth(41),
				sortable: false,
				suppressMovable: true,
				pinned: "left",
				hide: true,
				tree: false,
				valueGetter: serialValueGetter,
			})
		),
		{
			field: "account_label",
			headerName: __("Account"),
			headerClass: HEADER_CENTER,
			width: 300,
			minWidth: 200,
			pinned: "left",
			tree: true,
			edit: false,
			sortable: false,
			render: (params) => renderAccountLabel(params, form),
			treeContentKey: accountLabelTreeContentKey,
		},
	];

	return [
		...baseColumns,
		...buildPeriodColumns(form || {}, periodList),
		buildTotalColumn(form || {}, periodList),
	];
}

export function refreshColumns(frm) {
	const state = frm.project_budget;
	if (!state?.table?.setOption) return;
	state.table.setOption("columns", getColumns(frm, state.periods));
}

/** Toggle «План» / «Δ»: rebuild so leaf widths match legacy group. */
export function applyPlanDeltaVisibility(frm) {
	refreshColumns(frm);
}
