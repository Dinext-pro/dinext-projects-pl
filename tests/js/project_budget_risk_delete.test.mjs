import assert from "node:assert/strict";
import test from "node:test";

function createFakeNode(tagName) {
	const node = {
		tagName: String(tagName).toUpperCase(),
		className: "",
		type: "",
		title: "",
		dataset: {},
		textContent: "",
		innerHTML: "",
		children: [],
		querySelector(selector) {
			if (this.matches?.(selector)) return this;
			for (const child of this.children) {
				const found = child.querySelector(selector);
				if (found) return found;
			}
			return null;
		},
		matches(selector) {
			if (selector.startsWith(".")) {
				return this.className.split(/\s+/).includes(selector.slice(1));
			}
			return this.tagName === selector.toUpperCase();
		},
		appendChild(child) {
			this.children.push(child);
			return child;
		},
		addEventListener() {},
	};
	return node;
}

globalThis.__ = (text) => text;
globalThis.frappe = {
	confirm() {},
	call() {},
	show_alert() {},
	msgprint() {},
};
globalThis.document = {
	createElement(tagName) {
		return createFakeNode(tagName);
	},
};

const { accountLabelTreeContentKey, canDeleteRiskReserve, renderAccountLabel } =
	await import(
		"../../dinext_projects_pl/public/js/project_budget/risk-delete.js"
	);

test("canDeleteRiskReserve needs both risk and pb_docname", () => {
	assert.equal(canDeleteRiskReserve(null), false);
	assert.equal(canDeleteRiskReserve({ account_label: "⚠ Leak" }), false);
	assert.equal(canDeleteRiskReserve({ risk: "RISK-1" }), false);
	assert.equal(canDeleteRiskReserve({ pb_docname: "PRBU-1" }), false);
	assert.equal(
		canDeleteRiskReserve({ risk: "RISK-1", pb_docname: "PRBU-1" }),
		true
	);
});

test("accountLabelTreeContentKey remounts when reserve id changes", () => {
	assert.equal(accountLabelTreeContentKey({ data: {} }), "\0");
	assert.equal(
		accountLabelTreeContentKey({
			data: { risk: "RISK-1", pb_docname: "PRBU-1" },
		}),
		"RISK-1\0PRBU-1"
	);
});

test("renderAccountLabel shows close button only for reserve rows", () => {
	const plain = renderAccountLabel(
		{ value: "Expense", data: { account_label: "Expense" } },
		null
	);
	assert.equal(plain.querySelector(".delete-risk-reserve-btn"), null);
	assert.equal(plain.children[0].textContent, "Expense");

	const risk = renderAccountLabel(
		{
			value: "⚠ Leak",
			data: {
				risk: "RISK-1",
				pb_docname: "PRBU-1",
				account_label: "⚠ Leak",
			},
		},
		null
	);
	const btn = risk.querySelector(".delete-risk-reserve-btn");
	assert.ok(btn);
	assert.equal(btn.dataset.pbName, "PRBU-1");
	assert.equal(btn.title, "Delete risk reserves");
});
