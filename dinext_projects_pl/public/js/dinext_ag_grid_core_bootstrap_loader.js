// Loads dinext_common ag-grid/bootstrap.js before project_pl_ag_grid_bootstrap.js (cross-app hook order).
(function() {
    const BUILD = (window.DinextAgGrid && window.DinextAgGrid.build)
        || (window.DinextAgGridLoader && window.DinextAgGridLoader.BUILD)
        || "refactor-v1";
    const BOOTSTRAP_URL = `/assets/dinext_common/js/ag-grid/bootstrap.js?v=${BUILD}`;

    function isReady() {
        return !!(
            window.DinextAgGridCoreBootstrap
            && typeof window.DinextAgGridCoreBootstrap.ensureCore === "function"
        );
    }

    function loadBootstrapScript() {
        if (isReady()) {
            return Promise.resolve(window.DinextAgGridCoreBootstrap);
        }

        if (window.__dinext_ag_grid_bootstrap_script_promise) {
            return window.__dinext_ag_grid_bootstrap_script_promise;
        }

        window.__dinext_ag_grid_bootstrap_script_promise = new Promise((resolve, reject) => {
            const path = BOOTSTRAP_URL.split("?")[0];
            const existing = Array.from(document.scripts || []).find(script => {
                try {
                    return new URL(script.src, window.location.origin).pathname === path;
                } catch (error) {
                    return (script.getAttribute("src") || "").split("?")[0] === path;
                }
            });

            const finish = () => {
                if (isReady()) {
                    resolve(window.DinextAgGridCoreBootstrap);
                    return;
                }
                reject(new Error("ag-grid/bootstrap.js loaded but DinextAgGridCoreBootstrap is missing"));
            };

            if (existing) {
                if (isReady()) {
                    finish();
                    return;
                }
                existing.addEventListener("load", finish, { once: true });
                existing.addEventListener("error", () => {
                    reject(new Error("Failed to load " + BOOTSTRAP_URL));
                }, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = BOOTSTRAP_URL;
            script.onload = finish;
            script.onerror = () => reject(new Error("Failed to load " + BOOTSTRAP_URL));
            document.head.appendChild(script);
        });

        return window.__dinext_ag_grid_bootstrap_script_promise;
    }

    window.ensureDinextAgGridCoreBootstrap = loadBootstrapScript;
    loadBootstrapScript().catch(err => {
        console.error("DinextAgGrid bootstrap loader:", err);
    });
})();
