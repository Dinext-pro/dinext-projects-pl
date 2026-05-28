// Preload DinextAgGrid tree-dom + budgetTree for Project P&L.
(function() {
    if (window.__dinext_pl_ag_grid_bootstrap) {
        return;
    }

    const BUILD = (window.DinextAgGrid && window.DinextAgGrid.build)
        || (window.DinextAgGridLoader && window.DinextAgGridLoader.BUILD)
        || "refactor-v1";
    const BOOTSTRAP_URL = `/assets/dinext_common/js/ag-grid/bootstrap.js?v=${BUILD}`;

    function isBootstrapReady() {
        return !!(
            window.DinextAgGridCoreBootstrap
            && typeof window.DinextAgGridCoreBootstrap.ensureCore === "function"
        );
    }

    function loadBootstrapScript() {
        if (isBootstrapReady()) {
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
                if (isBootstrapReady()) {
                    resolve(window.DinextAgGridCoreBootstrap);
                    return;
                }
                reject(new Error("ag-grid/bootstrap.js loaded but DinextAgGridCoreBootstrap is missing"));
            };

            if (existing) {
                if (isBootstrapReady()) {
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

    if (typeof window.ensureDinextAgGridCoreBootstrap !== "function") {
        window.ensureDinextAgGridCoreBootstrap = loadBootstrapScript;
    }

    function startPlBootstrap() {
        const boot = window.DinextAgGridCoreBootstrap;
        if (!boot || typeof boot.ensureTreeDom !== "function") {
            throw new Error("DinextAgGridCoreBootstrap missing after loader");
        }
        return boot.ensureTreeDom().then(() => {
            if (!window.DinextAgGrid || typeof window.DinextAgGrid.use !== "function") {
                throw new Error("DinextAgGrid.use unavailable after ensureTreeDom");
            }
            return window.DinextAgGrid.use("budget-tree");
        });
    }

    window.__dinext_pl_ag_grid_bootstrap = window.ensureDinextAgGridCoreBootstrap()
        .then(startPlBootstrap);
})();
