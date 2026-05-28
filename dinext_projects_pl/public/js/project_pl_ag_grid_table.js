// Project P&L — thin adapter over DinextAgGrid.presets.budgetTree.
(function() {
    let ProjectPLAgGridTableClass = null;

    function getBudgetTreeTableClass() {
        const preset = window.DinextAgGrid && window.DinextAgGrid.presets && window.DinextAgGrid.presets.budgetTree;
        if (!preset || !preset.Table) {
            throw new Error("presets/budget-tree.js must load before project_pl_ag_grid_table.js");
        }
        return preset.Table;
    }

    function getProjectPLAgGridTableClass() {
        if (ProjectPLAgGridTableClass) {
            return ProjectPLAgGridTableClass;
        }

        const BudgetTreeTable = getBudgetTreeTableClass();

        ProjectPLAgGridTableClass = class ProjectPLAgGridTable extends BudgetTreeTable {
            constructor(container, options = {}) {
                if (options.columns !== undefined) {
                    throw new Error("ProjectPLAgGridTable: options.columns removed; use columnDefs.");
                }
                const columnDefs = options.columnDefs || [];
                const rows = options.rows ?? [];

                super(container, {
                    rows,
                    columnDefs,
                    getRowKey: (row, index) => {
                        if (!row) return `row-${index || 0}`;
                        return getBudgetRowKey(row) || `row-${index || 0}`;
                    },
                    getParentKey: row => {
                        if (!row) return null;
                        if (row._parentKey) return row._parentKey;
                        if (row.task && row.task.parent_task) return row.value + row.task.parent_task;
                        if (row.task) return row.value;
                        return row.parent_account || null;
                    },
                    getRowLevel: row => {
                        const indent = Number(row && row.indent);
                        return Number.isFinite(indent) ? Math.max(0, indent) : 0;
                    },
                    showTotalRow: options.showTotalRow !== false,
                    totalRow: options.totalRow,
                    treeToggleSelector: ".project-pl-tree-toggle",
                    forecastDom: options.forecastDom === false
                        ? false
                        : Object.assign(
                            { onSave: input => saveBudgetForecastInput(input) },
                            options.forecastDom
                        ),
                    toolbarTarget: options.toolbarTarget,
                    fullscreenShell: options.fullscreenShell || container.parentElement,
                    freezeMessage: options.freezeMessage,
                    feature: "project-pl",
                    containerClass: "project-pl-ag-grid",
                    classNames: { toolbar: "project-pl-ag-grid-toolbar" },
                    components: options.components,
                    onCellDoubleClicked: params => openBudgetGeneralLedgerFromTarget(
                        params.event && params.event.target
                    ),
                    gridOptions: Object.assign({
                        rowHeight: options.cellHeight || 30,
                        headerHeight: 64,
                        rowSelection: {
                            mode: "multiRow",
                            checkboxes: true,
                            headerCheckbox: true,
                            enableClickSelection: false
                        },
                        getRowClass: params => params.node && params.node.rowPinned ? "project-pl-total-row" : ""
                    }, options.gridOptions),
                    defaultColDef: options.defaultColDef
                });
            }
        };

        return ProjectPLAgGridTableClass;
    }

    window.getProjectPLAgGridTableClass = getProjectPLAgGridTableClass;
})();
