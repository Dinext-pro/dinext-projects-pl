// Desk entry: load project-budget.bundle.js and mount ProjectBudget on Project form.
// IIFE: doctype_js is concatenated into Project __js with other apps.
frappe.provide("dinext_projects_pl.projectBudget");

(function () {
	function bundlePath() {
		return frappe.assets.bundled_asset("project-budget.bundle.js");
	}

	function whenReady(frm, callback) {
		const run = () => {
			const mountPromise = window.ProjectBudget.ensureMounted(frm);
			Promise.resolve(mountPromise)
				.catch((err) => {
					console.error("[Project P&L] ensureMounted failed", err);
				})
				.finally(() => {
					callback?.();
				});
		};

		if (window.ProjectBudget?.isReady?.()) {
			run();
			return;
		}

		frappe.require([bundlePath()], () => {
			if (!window.ProjectBudget?.isReady?.()) {
				console.error("[Project P&L] project-budget.bundle.js did not register ProjectBudget");
				callback?.();
				return;
			}
			run();
		});
	}

	function onTogglePlanOrDelta(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.onTogglePlanOrDelta(frm);
		});
	}

	function onToggleDimensions(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.onToggleDimensions(frm);
		});
	}

	function onViewOptionsChange(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.onViewOptionsChange(frm);
		});
	}

	function onPeriodOrAggregateChange(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.onPeriodOrAggregateChange(frm);
		});
	}

	function saveForecastAsPlan(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.saveForecastAsPlan(frm);
		});
	}

	function refreshForecastDropdown(frm) {
		whenReady(frm, () => {
			window.ProjectBudget.refreshForecastDropdown?.(frm);
		});
	}

	Object.assign(dinext_projects_pl.projectBudget, {
		whenReady,
		onTogglePlanOrDelta,
		onToggleDimensions,
		onViewOptionsChange,
		onPeriodOrAggregateChange,
		saveForecastAsPlan,
		refreshForecastDropdown,
		destroy(frm) {
			window.ProjectBudget?.destroy(frm);
		},
	});
})();
