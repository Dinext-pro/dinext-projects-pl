// TEMPORARY bridge: legacy project_pl.js ↔ ProjectPlV2 bundle. Cutover: delete file.
// IIFE: doctype_js is concatenated into Project __js with other apps (WE).
// Bare `function whenReady` / `previewBundlePath` collide and steal the last definition.
frappe.provide("dinext_projects_pl.projectPlPreview");

(function () {
	function previewBundlePath() {
		return frappe.assets.bundled_asset("pl-v2.bundle.js");
	}

	function whenReady(frm, callback) {
		const run = () => {
			const mountPromise = window.ProjectPlV2.ensureMounted(frm);
			Promise.resolve(mountPromise)
				.catch((err) => {
					console.error("[Project P&L] ensureMounted failed", err);
				})
				.finally(() => {
					callback?.();
				});
		};

		if (window.ProjectPlV2?.isReady?.()) {
			run();
			return;
		}

		frappe.require([previewBundlePath()], () => {
			if (!window.ProjectPlV2?.isReady?.()) {
				console.error("[Project P&L] pl-v2.bundle.js did not register ProjectPlV2");
				callback?.();
				return;
			}
			run();
		});
	}

	function onTogglePlanOrDelta(frm) {
		whenReady(frm, () => {
			window.ProjectPlV2.onTogglePlanOrDelta(frm);
		});
	}

	function onViewOptionsChange(frm) {
		whenReady(frm, () => {
			window.ProjectPlV2.onViewOptionsChange(frm);
		});
	}

	function saveForecastAsPlan(frm) {
		whenReady(frm, () => {
			window.ProjectPlV2.saveForecastAsPlan(frm);
		});
	}

	Object.assign(dinext_projects_pl.projectPlPreview, {
		whenReady,
		onTogglePlanOrDelta,
		onViewOptionsChange,
		saveForecastAsPlan,
		destroy(frm) {
			window.ProjectPlV2?.destroy(frm);
		},
	});
})();
