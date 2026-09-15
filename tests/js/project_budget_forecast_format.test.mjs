import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatAmount,
	formatForecastAmount,
	plAmountValueParser,
} from "../../dinext_projects_pl/public/js/project_budget/columns.js";

test("formatAmount still paints 0", () => {
	assert.equal(formatAmount({ value: 0, data: {} }), "0");
	assert.equal(formatAmount({ value: 1500, data: {} }), "1 500");
});

test("formatForecastAmount paints empty zero like formatAmount", () => {
	assert.equal(formatForecastAmount({ value: 0, data: {} }), "0");
	assert.equal(formatForecastAmount({ value: null, data: {} }), "");
	assert.equal(formatForecastAmount({ value: 1500, data: {} }), "1 500");
});

test("formatForecastAmount keeps profitability percent", () => {
	assert.equal(
		formatForecastAmount({ value: 0, data: { summary_kind: "profitability" } }),
		"0.0%",
	);
});

test("plAmountValueParser keeps typed 0, empty is clear", () => {
	assert.equal(plAmountValueParser({ newValue: 0, oldValue: 80 }), 0);
	assert.equal(plAmountValueParser({ newValue: "0", oldValue: 80 }), 0);
	assert.equal(plAmountValueParser({ newValue: "", oldValue: 80 }), null);
	assert.equal(plAmountValueParser({ newValue: null, oldValue: 80 }), null);
});
