(function () {
    const PL_AG_GRID_CSS = "/assets/dinext_projects_pl/css/project-pl-ag-grid.css?v=pl-ag-grid-v1";

    function loadStyleOnce(url) {
        const path = url.split("?")[0];
        const exists = Array.from(document.querySelectorAll("link[rel='stylesheet']")).some(link => {
            try {
                return new URL(link.href, window.location.origin).pathname === path;
            } catch (error) {
                return (link.getAttribute("href") || "").split("?")[0] === path;
            }
        });
        if (exists) return;

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
    }

    loadStyleOnce(PL_AG_GRID_CSS);
})();
