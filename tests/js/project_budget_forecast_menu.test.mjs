import { test } from "node:test";
import assert from "node:assert/strict";
import {
	RISK_FORECAST_FLAG,
	WE_FORECAST_FLAG,
	getForecastMenuItems,
	replaceForecastMenuItems,
	syncForecastMenuAliases,
} from "../../dinext_projects_pl/public/js/project_budget/forecast-menu.js";

function noop() {}

function riskItem() {
	return {
		label: "Include Risk Reserve",
		action: noop,
		[RISK_FORECAST_FLAG]: true,
	};
}

function weCostItem() {
	return {
		label: "Cost forecast from work efforts",
		action: noop,
		[WE_FORECAST_FLAG]: true,
		__pwr_pl_forecast_kind: "cost",
	};
}

function frmWithReserve() {
	return {
		doc: {
			custom_project_risks: [{ contingency_reserve: 10000 }],
			custom_payment_scheme: "Фикс",
		},
	};
}

test("sync merges split aliases onto one array", () => {
	const risk = riskItem();
	const we = weCostItem();
	const dp = {
		project_pl_forecast_menu: [we],
		project_budget_forecast_menu: [risk],
	};
	const menu = syncForecastMenuAliases(dp);
	assert.equal(dp.project_pl_forecast_menu, dp.project_budget_forecast_menu);
	assert.equal(menu, dp.project_budget_forecast_menu);
	assert.equal(menu.includes(we), true);
	assert.equal(menu.includes(risk), true);
});

test("replaceForecastMenuItems keeps risk when WE re-registers", () => {
	const dp = { project_pl_forecast_menu: [], project_budget_forecast_menu: [] };
	replaceForecastMenuItems(RISK_FORECAST_FLAG, [riskItem()], dp);
	replaceForecastMenuItems(WE_FORECAST_FLAG, [weCostItem()], dp);
	assert.equal(dp.project_pl_forecast_menu, dp.project_budget_forecast_menu);
	assert.equal(dp.project_budget_forecast_menu.length, 2);
	assert.equal(
		dp.project_budget_forecast_menu.some((item) => item[RISK_FORECAST_FLAG]),
		true
	);
	assert.equal(
		dp.project_budget_forecast_menu.some((item) => item[WE_FORECAST_FLAG]),
		true
	);
});

test("replaceForecastMenuItems does not change array reference", () => {
	const dp = { project_pl_forecast_menu: [], project_budget_forecast_menu: [] };
	syncForecastMenuAliases(dp);
	const first = dp.project_budget_forecast_menu;
	replaceForecastMenuItems(RISK_FORECAST_FLAG, [riskItem()], dp);
	replaceForecastMenuItems(WE_FORECAST_FLAG, [weCostItem()], dp);
	assert.equal(dp.project_budget_forecast_menu, first);
});

test("getForecastMenuItems keeps risk after WE replace", () => {
	const dp = { project_pl_forecast_menu: [], project_budget_forecast_menu: [] };
	replaceForecastMenuItems(RISK_FORECAST_FLAG, [riskItem()], dp);
	replaceForecastMenuItems(WE_FORECAST_FLAG, [weCostItem()], dp);
	const items = getForecastMenuItems(frmWithReserve(), dp);
	assert.equal(items.some((item) => item[RISK_FORECAST_FLAG]), true);
	assert.equal(items.some((item) => item[WE_FORECAST_FLAG]), true);
});
