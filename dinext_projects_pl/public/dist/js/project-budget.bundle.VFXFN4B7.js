(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/lazy-tab-mount.js
  function getFieldTab(frm, fieldname) {
    var _a, _b, _c, _d, _e, _f;
    const field = (_a = frm == null ? void 0 : frm.get_field) == null ? void 0 : _a.call(frm, fieldname);
    if (!field) {
      return null;
    }
    if (field.tab) {
      return field.tab;
    }
    const node = (_c = (_b = field.$wrapper) == null ? void 0 : _b.get) == null ? void 0 : _c.call(_b, 0);
    const tabs = (_d = frm.layout) == null ? void 0 : _d.tabs;
    if (!node || !(tabs == null ? void 0 : tabs.length)) {
      return null;
    }
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const pane = (_f = (_e = tab.wrapper) == null ? void 0 : _e.get) == null ? void 0 : _f.call(_e, 0);
      if (pane && $.contains(pane, node)) {
        return tab;
      }
    }
    return null;
  }
  function isFieldTabVisible(frm, fieldname) {
    var _a, _b;
    const tab = getFieldTab(frm, fieldname);
    if (!tab) {
      return false;
    }
    return typeof tab.is_active === "function" ? tab.is_active() : !!((_b = (_a = tab.wrapper) == null ? void 0 : _a.hasClass) == null ? void 0 : _b.call(_a, "active"));
  }
  function ensureLazyState(frm) {
    if (!frm._pwaLazy) {
      frm._pwaLazy = {
        mountFns: {},
        done: {},
        inflight: {},
        overlayCount: {},
        bound: {}
      };
    }
    return frm._pwaLazy;
  }
  function tabPaneKey(frm, fieldname) {
    const tab = getFieldTab(frm, fieldname);
    return tab && tab.df && tab.df.fieldname || fieldname;
  }
  function showTabOverlay(frm, fieldname) {
    const tab = getFieldTab(frm, fieldname);
    const $pane = tab && tab.wrapper;
    if (!$pane || !$pane.length) {
      return;
    }
    const state = ensureLazyState(frm);
    const key = tabPaneKey(frm, fieldname);
    state.overlayCount[key] = (state.overlayCount[key] || 0) + 1;
    if (state.overlayCount[key] > 1) {
      return;
    }
    $pane.addClass("pwa-tab-loading-host");
    let $el = $pane.children(".pwa-tab-loading");
    if (!$el.length) {
      const label = frappe.utils.escape_html(__("Loading\u2026"));
      $el = $(
        `<div class="pwa-tab-loading" aria-live="polite"><p class="text-muted">${label}</p></div>`
      );
      $pane.prepend($el);
    }
    $el.removeClass("is-hidden");
  }
  function hideTabOverlay(frm, fieldname) {
    const tab = getFieldTab(frm, fieldname);
    const $pane = tab && tab.wrapper;
    if (!$pane || !$pane.length) {
      return;
    }
    const state = ensureLazyState(frm);
    const key = tabPaneKey(frm, fieldname);
    state.overlayCount[key] = Math.max(0, (state.overlayCount[key] || 0) - 1);
    if (state.overlayCount[key] > 0) {
      return;
    }
    $pane.children(".pwa-tab-loading").addClass("is-hidden");
  }
  function runLazyMount(frm, fieldname) {
    const state = ensureLazyState(frm);
    if (state.done[fieldname] || state.inflight[fieldname]) {
      return;
    }
    const mountFn = state.mountFns[fieldname];
    if (typeof mountFn !== "function") {
      return;
    }
    state.inflight[fieldname] = true;
    showTabOverlay(frm, fieldname);
    Promise.resolve().then(() => mountFn()).catch((err) => {
      console.error(`[LazyTabMount] ${fieldname} failed`, err);
    }).finally(() => {
      state.inflight[fieldname] = false;
      state.done[fieldname] = true;
      hideTabOverlay(frm, fieldname);
    });
  }
  function bindLazyTabMount(frm, fieldname, mountFn) {
    if (!frm || !fieldname || typeof mountFn !== "function") {
      return;
    }
    const state = ensureLazyState(frm);
    state.mountFns[fieldname] = mountFn;
    if (!state.inflight[fieldname]) {
      delete state.done[fieldname];
    }
    const attach = () => {
      var _a, _b;
      const tab = getFieldTab(frm, fieldname);
      if (!tab) {
        return false;
      }
      const $link = (_b = (_a = tab.tab_link) == null ? void 0 : _a.find) == null ? void 0 : _b.call(_a, ".nav-link");
      if (($link == null ? void 0 : $link.length) && !state.bound[fieldname]) {
        state.bound[fieldname] = true;
        $link.on("shown.bs.tab", function() {
          runLazyMount(frm, fieldname);
        });
      }
      if (isFieldTabVisible(frm, fieldname)) {
        runLazyMount(frm, fieldname);
      }
      return true;
    };
    if (attach()) {
      return;
    }
    setTimeout(() => {
      attach();
    }, 0);
  }
  function installLazyTabMountApi() {
    frappe.provide("project_workload_assignment");
    const api = project_workload_assignment;
    api.getFieldTab = getFieldTab;
    api.isFieldTabVisible = isFieldTabVisible;
    api.bindLazyTabMount = bindLazyTabMount;
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/state.js
  function initState(frm) {
    if (!frm.project_budget) {
      frm.project_budget = {
        table: null,
        rows: [],
        periods: [],
        summaryRows: [],
        expandedIds: [],
        container: null
      };
    }
    return frm.project_budget;
  }
  function destroyTable(frm) {
    var _a;
    const state = frm.project_budget;
    if ((_a = state == null ? void 0 : state.table) == null ? void 0 : _a.destroy) {
      state.table.destroy();
    }
    if (state) {
      state.table = null;
      state.container = null;
      state._mountPromise = null;
      state._initPromise = null;
    }
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/constants.js
  var GRID_API = "dinext_projects_pl.api.get_project_budget_grid";
  var SAVE_FORECAST_API = "dinext_projects_pl.api.save_project_budget_forecast";
  var DIM_OPTIONS_API = "dinext_projects_pl.api.get_account_dimension_options";
  var ADD_DIMENSION_API = "dinext_projects_pl.api.add_project_budget_dimension";
  var MERGE_GROUP = {
    idField: "merge_group_id",
    indexField: "merge_group_index",
    sizeField: "merge_group_size"
  };

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/data.js
  function applyGridResponse(frm, message) {
    const state = initState(frm);
    state.periods = message.periods || [];
    state.rows = message.rows || [];
    state.summaryRows = message.summary_rows || [];
    return message;
  }
  async function loadGridData(frm) {
    const period_type = frm._pl_period_type || "month";
    try {
      const message = await frappe.xcall(GRID_API, {
        project: frm.doc.name,
        period_type,
        view_options: frm.budget_view_options || __("Forecast and actual"),
        show_dimensions: frm.bg_show_dimensions ? 1 : 0,
        aggregate_fact: frm.bg_aggregate_fact === false ? 0 : 1,
        show_task_hierarchy: frm.bg_show_task_hierarchy === false ? 0 : 1
      });
      if (!message) {
        throw new Error("Empty grid response");
      }
      return applyGridResponse(frm, message);
    } catch (err) {
      console.error("[Project P&L] grid load failed", err);
      frappe.msgprint(__("Error loading P&L data"));
      throw err;
    }
  }
  async function reloadTable(frm, initTable2, refreshRuntime2) {
    const state = frm.project_budget;
    if (!(state == null ? void 0 : state.container)) {
      return null;
    }
    await loadGridData(frm);
    if (state.table) {
      await refreshRuntime2(frm);
      return state.table;
    }
    return initTable2(frm);
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/dimensions-ui.js
  var openMenuEl = null;
  var openMenuCloser = null;
  function stopGridEvent(e) {
    e.stopPropagation();
  }
  function closeAddDimMenu() {
    if (openMenuCloser) {
      document.removeEventListener("mousedown", openMenuCloser, true);
      openMenuCloser = null;
    }
    if (openMenuEl) {
      openMenuEl.remove();
      openMenuEl = null;
    }
  }
  function isMergeHead(row) {
    const index = row == null ? void 0 : row[MERGE_GROUP.indexField];
    return index == null || index === 0;
  }
  async function loadDimOptions(frm, account) {
    return frappe.xcall(DIM_OPTIONS_API, {
      project: frm.doc.name,
      account
    });
  }
  async function addDimension(frm, row, dimDoc, dimDocname, mode) {
    var _a, _b;
    const res = await frappe.xcall(ADD_DIMENSION_API, {
      project: frm.doc.name,
      account: row.account,
      dim_doc: dimDoc,
      dim_docname: dimDocname,
      mode: mode || "new",
      pb_docname: row.pb_docname || "",
      base_dimensions: JSON.stringify(row.dimensions || [])
    });
    const msg = mode === "existing" ? __("Dimension added to the entry") : (res == null ? void 0 : res.created) ? __("Budget row with dimension created") : __("Budget row with this dimension already exists");
    frappe.show_alert({ message: msg, indicator: "green" }, 3);
    frm.bg_show_dimensions = true;
    await ((_b = (_a = window.ProjectBudget) == null ? void 0 : _a.refresh) == null ? void 0 : _b.call(_a, frm));
  }
  function pickValueThenAdd(frm, row, dimType, mode) {
    const options = dimType.options || [];
    if (!options.length) {
      frappe.msgprint(__("No values available for {0}", [dimType.label || dimType.document_type]));
      return;
    }
    const d = new frappe.ui.Dialog({
      title: __("Add Dimension: {0}", [dimType.label || dimType.document_type]),
      fields: [
        {
          fieldtype: "Select",
          fieldname: "docname",
          label: __("Value"),
          options: options.map((o) => o.value).join("\n"),
          reqd: 1
        }
      ],
      primary_action_label: __("Add"),
      primary_action: (values) => {
        d.hide();
        addDimension(frm, row, dimType.document_type, values.docname, mode).catch((err) => {
          console.error(err);
          frappe.msgprint(__("Error adding dimension"));
        });
      }
    });
    d.show();
  }
  function openAddDimMenu(frm, row, anchorEl, payload) {
    closeAddDimMenu();
    const dimensions = ((payload == null ? void 0 : payload.dimensions) || []).filter((d) => (d.options || []).length);
    if (!dimensions.length) {
      frappe.msgprint(__("No available dimensions for this account (Accounting Dimension Filter)"));
      return;
    }
    const menu = document.createElement("div");
    menu.className = "dropdown-menu pl-dim-add-menu show";
    menu.style.position = "fixed";
    menu.style.zIndex = "1051";
    menu.style.display = "block";
    menu.style.minWidth = "220px";
    const addSection = (title, mode) => {
      const head = document.createElement("div");
      head.className = "dropdown-header";
      head.textContent = title;
      menu.appendChild(head);
      for (const dimType of dimensions) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-item";
        item.textContent = dimType.label || dimType.document_type;
        item.addEventListener("mousedown", stopGridEvent);
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          closeAddDimMenu();
          pickValueThenAdd(frm, row, dimType, mode);
        });
        menu.appendChild(item);
      }
    };
    addSection(__("New Account Row"), "new");
    if (row.pb_docname) {
      menu.appendChild(document.createElement("div")).className = "dropdown-divider";
      addSection(__("To Current Entry"), "existing");
    }
    document.body.appendChild(menu);
    openMenuEl = menu;
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(rect.bottom + 2, window.innerHeight - menu.offsetHeight - 8);
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, left)}px`;
    openMenuCloser = (event) => {
      if (menu.contains(event.target) || anchorEl.contains(event.target)) {
        return;
      }
      closeAddDimMenu();
    };
    document.addEventListener("mousedown", openMenuCloser, true);
  }
  function buildAddDimControl(frm, row) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-default btn-xs pl-dim-add";
    btn.title = __("Add Dimension");
    btn.setAttribute("aria-label", __("Add Dimension"));
    btn.textContent = "+";
    btn.addEventListener("mousedown", stopGridEvent);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenuEl) {
        closeAddDimMenu();
        return;
      }
      loadDimOptions(frm, row.account).then((payload) => openAddDimMenu(frm, row, btn, payload)).catch((err) => {
        console.error(err);
        frappe.msgprint(__("Failed to load dimensions list"));
      });
    });
    return btn;
  }
  function dimensionCellRenderer(frm) {
    return function(params) {
      const row = params.data;
      const wrap = document.createElement("div");
      wrap.className = "pl-dim-cell";
      if (!row || row.summary_kind) {
        return wrap;
      }
      const label = document.createElement("span");
      label.className = "pl-dim-label";
      const raw = row.dimension_label || "";
      label.textContent = raw === "\u2014" ? "" : raw;
      wrap.appendChild(label);
      if ((frm == null ? void 0 : frm.bg_show_dimensions) && row.account && isMergeHead(row) && !row.risk) {
        const add = buildAddDimControl(frm, row);
        wrap.appendChild(add);
      }
      return wrap;
    };
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/columns.js
  var LEGACY_PERIOD_GROUP_WIDTH = 210;
  var LEGACY_PLAN_SUBCOL_WIDTH = 70;
  var LEGACY_DELTA_SUBCOL_WIDTH = 50;
  var ALIGN_CENTER = "dinext-table-cell--align-center";
  var HEADER_CENTER = "project-budget-header--center";
  var CELL_ZERO = "project-budget-cell--zero";
  var CELL_PROFIT_POS = "project-budget-cell--profit-pos";
  var CELL_PROFIT_NEG = "project-budget-cell--profit-neg";
  function periodLeafWidth(hidePlan, hideDelta) {
    let group = LEGACY_PERIOD_GROUP_WIDTH;
    if (hidePlan)
      group -= LEGACY_PLAN_SUBCOL_WIDTH;
    if (hideDelta)
      group -= LEGACY_DELTA_SUBCOL_WIDTH;
    const visible = 1 + (hidePlan ? 0 : 1) + (hideDelta ? 0 : 1);
    return Math.round(group / visible);
  }
  function toNumber(value) {
    const n = typeof value === "number" ? value : parseFloat(String(value != null ? value : ""));
    return Number.isFinite(n) ? n : null;
  }
  function isProfitabilityRow(data) {
    return (data == null ? void 0 : data.summary_kind) === "profitability";
  }
  function isProfitRow(data) {
    return (data == null ? void 0 : data.summary_kind) === "profit";
  }
  function formatAmount(params) {
    const n = toNumber(params.value);
    if (n == null)
      return "";
    if (isProfitabilityRow(params.data)) {
      return `${n.toFixed(1)}%`;
    }
    return n.toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  function formatDelta(params) {
    const n = toNumber(params.value);
    if (n == null)
      return "";
    if (n === 0)
      return "0%";
    return `${n.toFixed(1)}%`;
  }
  function isZeroValue(params) {
    const n = toNumber(params.value);
    return n != null && n === 0;
  }
  var AMOUNT_CELL_CLASS_RULES = {
    [CELL_ZERO]: isZeroValue,
    [CELL_PROFIT_POS]: (params) => {
      if (!isProfitRow(params.data))
        return false;
      const n = toNumber(params.value);
      return n != null && n > 0;
    },
    [CELL_PROFIT_NEG]: (params) => {
      if (!isProfitRow(params.data))
        return false;
      const n = toNumber(params.value);
      return n != null && n < 0;
    }
  };
  function fixedWidth(width) {
    return {
      width,
      minWidth: width,
      maxWidth: width,
      resizable: false,
      suppressSizeToFit: true
    };
  }
  function mergeClassList(existing, next) {
    if (!existing)
      return next;
    if (typeof existing === "string")
      return `${existing} ${next}`;
    if (Array.isArray(existing))
      return [...existing, next];
    return existing;
  }
  function withCenterAlign(col) {
    return __spreadProps(__spreadValues({}, col), {
      cellClass: mergeClassList(col.cellClass, ALIGN_CENTER),
      headerClass: mergeClassList(col.headerClass, HEADER_CENTER)
    });
  }
  function buildRowSerialMap(rows) {
    const map = /* @__PURE__ */ new Map();
    let serial = 0;
    function walk(list) {
      var _a;
      for (const row of list || []) {
        if ((row == null ? void 0 : row.id) != null) {
          serial += 1;
          map.set(row.id, serial);
        }
        if ((_a = row.children) == null ? void 0 : _a.length) {
          walk(row.children);
        }
      }
    }
    walk(rows);
    return map;
  }
  function serialValueGetter(params) {
    var _a, _b, _c, _d, _e, _f;
    const data = params.data;
    if (!(data == null ? void 0 : data.id) || data.summary_kind)
      return "";
    const sourceRows = ((_b = (_a = params.context) == null ? void 0 : _a.dinextTable) == null ? void 0 : _b.sourceData) || ((_e = (_d = (_c = params.context) == null ? void 0 : _c.dinextTable) == null ? void 0 : _d.options) == null ? void 0 : _e.data) || [];
    const map = buildRowSerialMap(sourceRows);
    return (_f = map.get(data.id)) != null ? _f : "";
  }
  function buildPeriodLeaf(opts) {
    const { field, colId, headerName, width, hide, valueFormatter, edit, pinned } = opts;
    const col = withCenterAlign(__spreadProps(__spreadValues({
      field,
      colId,
      headerName
    }, fixedWidth(width)), {
      sortable: false,
      suppressMovable: true,
      tree: false,
      type: "number",
      edit: edit === void 0 ? false : edit,
      hide: !!hide,
      valueFormatter,
      cellClassRules: __spreadValues({}, AMOUNT_CELL_CLASS_RULES)
    }));
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
      const headerName = period.label || (period.quarter ? `Q${period.quarter} ${period.year}` : period.month ? `${period.year}-${String(period.month).padStart(2, "0")}` : String(period.year));
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
            valueFormatter: formatAmount
          }),
          buildPeriodLeaf({
            field: `actual_${key}`,
            colId: `actual_${key}`,
            headerName: actualLabel,
            width: leafWidth,
            edit: (row) => canEditForecast && !period.is_past && !(row == null ? void 0 : row.summary_kind),
            valueFormatter: formatAmount
          }),
          buildPeriodLeaf({
            field: `delta_${key}`,
            colId: `delta_${key}`,
            headerName: "\u0394",
            width: leafWidth,
            hide: hideDelta,
            valueFormatter: formatDelta
          })
        ]
      };
    });
  }
  function buildTotalColumn(frm, periods) {
    const hidePlan = !!frm.bg_hide_plan;
    const hideDelta = !!frm.bg_hide_delta;
    const leafWidth = periodLeafWidth(hidePlan, hideDelta);
    const last = periods == null ? void 0 : periods[periods.length - 1];
    const actualLabel = (last == null ? void 0 : last.is_past) ? __("Actual") : __("Forecast");
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
          valueFormatter: formatAmount
        }),
        buildPeriodLeaf({
          field: "actual_total",
          colId: "actual_total",
          headerName: actualLabel,
          width: leafWidth,
          pinned: "right",
          valueFormatter: formatAmount
        }),
        buildPeriodLeaf({
          field: "delta_total",
          colId: "delta_total",
          headerName: "\u0394",
          width: leafWidth,
          hide: hideDelta,
          pinned: "right",
          valueFormatter: formatDelta
        })
      ]
    };
  }
  function getColumns(frm, periods) {
    var _a;
    const form = frm || (typeof cur_frm !== "undefined" ? cur_frm : null);
    const periodList = periods || ((_a = form == null ? void 0 : form.project_budget) == null ? void 0 : _a.periods) || [];
    const showDimensions = !!(form == null ? void 0 : form.bg_show_dimensions);
    const spanRows = showDimensions ? DinextTable.createMergeGroupSpanRows({ mergeGroup: MERGE_GROUP }) : void 0;
    const baseColumns = [
      withCenterAlign(__spreadProps(__spreadValues({
        field: "account_serial",
        colId: "account_serial",
        headerName: ""
      }, fixedWidth(41)), {
        sortable: false,
        suppressMovable: true,
        pinned: "left",
        hide: true,
        tree: false,
        spanRows,
        valueGetter: serialValueGetter
      })),
      {
        field: "account_label",
        headerName: __("Account"),
        headerClass: HEADER_CENTER,
        width: showDimensions ? 260 : 300,
        minWidth: 200,
        pinned: "left",
        tree: true,
        edit: false,
        sortable: false,
        spanRows
      }
    ];
    if (showDimensions) {
      baseColumns.push({
        field: "dimension_label",
        colId: "dimension_label",
        headerName: __("Dimension"),
        headerClass: HEADER_CENTER,
        width: 220,
        minWidth: 160,
        pinned: "left",
        tree: false,
        edit: false,
        sortable: false,
        suppressMovable: true,
        cellRenderer: dimensionCellRenderer(form || {})
      });
    }
    return [
      ...baseColumns,
      ...buildPeriodColumns(form || {}, periodList),
      buildTotalColumn(form || {}, periodList)
    ];
  }
  function refreshColumns(frm) {
    var _a;
    const state = frm.project_budget;
    if (!((_a = state == null ? void 0 : state.table) == null ? void 0 : _a.setOption))
      return;
    state.table.setOption("columns", getColumns(frm, state.periods));
  }
  function applyPlanDeltaVisibility(frm) {
    refreshColumns(frm);
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/tree.js
  function getDefaultExpandedIds(rows) {
    return (rows || []).filter((row) => {
      var _a;
      return (row == null ? void 0 : row.id) != null && (((_a = row.children) == null ? void 0 : _a.length) || row.has_children);
    }).map((row) => String(row.id));
  }
  function syncExpandedIds(frm) {
    var _a;
    const table = (_a = frm.project_budget) == null ? void 0 : _a.table;
    if (!(table == null ? void 0 : table.expandedIds))
      return;
    const ids = [...table.expandedIds];
    frm._project_budget_expanded_ids = ids;
    if (frm.project_budget) {
      frm.project_budget.expandedIds = ids;
    }
  }
  function attachTreePersistence(frm, table) {
    if (!table || table._treePersistence)
      return;
    const wrap = (methodName, isAsync = false) => {
      var _a;
      const original = (_a = table[methodName]) == null ? void 0 : _a.bind(table);
      if (!original)
        return;
      if (isAsync) {
        table[methodName] = async (...args) => {
          const result = await original(...args);
          syncExpandedIds(frm);
          return result;
        };
        return;
      }
      table[methodName] = (...args) => {
        const result = original(...args);
        syncExpandedIds(frm);
        return result;
      };
    };
    wrap("toggleRow");
    wrap("expandRow", true);
    wrap("collapseRow");
    table._treePersistence = true;
  }
  function getExpandedIds(frm) {
    var _a, _b, _c, _d;
    if ((_a = frm._project_budget_expanded_ids) == null ? void 0 : _a.length) {
      return frm._project_budget_expanded_ids;
    }
    if ((_c = (_b = frm.project_budget) == null ? void 0 : _b.expandedIds) == null ? void 0 : _c.length) {
      return frm.project_budget.expandedIds;
    }
    return getDefaultExpandedIds(((_d = frm.project_budget) == null ? void 0 : _d.rows) || []);
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/budget-tree.js
  function flattenTree(rows) {
    var _a;
    const result = [];
    for (const row of rows || []) {
      result.push(row);
      if ((_a = row.children) == null ? void 0 : _a.length) {
        result.push(...flattenTree(row.children));
      }
    }
    return result;
  }
  function periodKey(period) {
    if (!period)
      return "";
    if (period.key)
      return period.key;
    return `${period.year}_${period.month}`;
  }
  function dimsKey(dimensions) {
    return (dimensions || []).map((d) => `${d.doc}:${d.docname}`).sort().join("|");
  }
  function forecastOf(row, key) {
    var _a, _b;
    return Number((_b = (_a = row == null ? void 0 : row[`forecast_${key}`]) != null ? _a : row == null ? void 0 : row[`actual_${key}`]) != null ? _b : 0);
  }
  function setForecast(row, key, value) {
    if (!row)
      return;
    row[`forecast_${key}`] = Number(value) || 0;
  }
  function findParent(rows, childId, parent = null) {
    var _a;
    for (const row of rows || []) {
      if (row.id === childId)
        return parent;
      if ((_a = row.children) == null ? void 0 : _a.length) {
        const found = findParent(row.children, childId, row);
        if (found !== void 0)
          return found;
      }
    }
    return void 0;
  }
  function childForecastSum(row, key, excludeId = null) {
    let sum = 0;
    for (const child of row.children || []) {
      if (excludeId && child.id === excludeId)
        continue;
      const own = forecastOf(child, key);
      if (own) {
        sum += own;
      } else {
        sum += childForecastSum(child, key);
      }
    }
    return sum;
  }
  function parentForecastLimit(rows, row, key) {
    let current = row;
    while (current) {
      const parent = findParent(rows, current.id);
      if (!parent)
        return null;
      const parentForecast = forecastOf(parent, key);
      if (parentForecast > 0) {
        const siblings = childForecastSum(parent, key, current.id);
        return {
          maxAllowed: parentForecast - siblings,
          parent,
          parentLabel: parent.account_label || parent.account
        };
      }
      current = parent;
    }
    return null;
  }
  function getDisplayPeriods(frm) {
    var _a;
    const fromV2 = (_a = frm == null ? void 0 : frm.project_budget) == null ? void 0 : _a.periods;
    if (fromV2 == null ? void 0 : fromV2.length) {
      return fromV2.map((p) => ({
        year: p.year,
        month: p.month,
        key: p.key || `${p.year}_${p.month}`,
        is_past: !!p.is_past
      }));
    }
    if (typeof get_budget_display_periods === "function") {
      return (get_budget_display_periods(frm, "month") || []).map((p) => ({
        year: p.year,
        month: p.month,
        key: `${p.year}_${p.month}`,
        is_past: !!p.is_past
      }));
    }
    return [];
  }
  function accountAllowsTask(rows, account) {
    if (!account)
      return false;
    return flattenTree(rows).some((r) => r.account === account && r.task);
  }
  function findRowByAccountDims(rows, account, dimensions) {
    const want = dimsKey(
      (dimensions || []).filter((d) => d && d.doc !== "Project Risk")
    );
    const flat = flattenTree(rows);
    let best = null;
    for (const row of flat) {
      if (row.summary_kind || row.account !== account)
        continue;
      const rowDims = dimsKey(
        (row.dimensions || []).filter((d) => d && d.doc !== "Project Risk")
      );
      if (rowDims === want) {
        best = row;
        break;
      }
      if (!want && !row.task && !row.risk && !best) {
        best = row;
      }
    }
    return best;
  }
  function getBasisForecastMap(rows, account, dimensions, periods) {
    const out = {};
    const row = findRowByAccountDims(rows, account, dimensions);
    if (!row || !(periods == null ? void 0 : periods.length))
      return out;
    for (const p of periods) {
      const key = periodKey(p);
      out[key] = flt(forecastOf(row, key), 2);
    }
    return out;
  }
  function cloneTree(rows) {
    return JSON.parse(JSON.stringify(rows || []));
  }
  function applyUpdatesToTree(rows, updates) {
    var _a, _b;
    const root = cloneTree(rows);
    for (const item of updates || []) {
      const account = (item.account || "").trim();
      const dimensions = item.dimensions || [];
      const taskId = ((_a = dimensions.find((d) => (d == null ? void 0 : d.doc) === "Task")) == null ? void 0 : _a.docname) || "";
      const riskId = ((_b = dimensions.find((d) => (d == null ? void 0 : d.doc) === "Project Risk")) == null ? void 0 : _b.docname) || "";
      const periodAmountMap = item.period_amount_map || {};
      let row = findRowByAccountDims(root, account, dimensions);
      if (!row && riskId) {
        const parentDims = taskId ? [{ doc: "Task", docname: taskId }] : [];
        const parent = findRowByAccountDims(root, account, parentDims);
        if (parent) {
          row = {
            id: `${parent.id}|risk|${riskId}`,
            account,
            account_label: parent.account_label,
            task: taskId || null,
            risk: riskId,
            dimensions: dimensions.slice(),
            children: [],
            has_children: false,
            expandable: false
          };
          parent.children = parent.children || [];
          parent.children.push(row);
          parent.has_children = true;
          parent.expandable = true;
        }
      }
      if (!row)
        continue;
      for (const pk of Object.keys(periodAmountMap)) {
        const amount = flt(periodAmountMap[pk], 2);
        if (amount <= 0)
          continue;
        setForecast(row, pk, forecastOf(row, pk) + amount);
      }
    }
    return root;
  }
  function buildParentAdjustmentsFromUpdates(frm, updates) {
    var _a, _b;
    const parent_adjustments = [];
    const adjusted_parents = [];
    const rows = (_a = frm == null ? void 0 : frm.project_budget) == null ? void 0 : _a.rows;
    if (!(rows == null ? void 0 : rows.length) || !(updates == null ? void 0 : updates.length)) {
      return { parent_adjustments, adjusted_parents };
    }
    const simulated = applyUpdatesToTree(rows, updates);
    const periodKeys = /* @__PURE__ */ new Set();
    for (const item of updates) {
      for (const pk of Object.keys(item.period_amount_map || {})) {
        periodKeys.add(pk);
      }
    }
    if (!periodKeys.size) {
      return { parent_adjustments, adjusted_parents };
    }
    const adjustmentMap = {};
    for (const item of updates) {
      const account = (item.account || "").trim();
      const dimensions = item.dimensions || [];
      let leaf = findRowByAccountDims(simulated, account, dimensions);
      if (!leaf)
        continue;
      for (const pk of periodKeys) {
        const reserveValue = flt((_b = item.period_amount_map) == null ? void 0 : _b[pk], 2);
        if (reserveValue <= 0)
          continue;
        let current = leaf;
        while (current) {
          const limit = parentForecastLimit(simulated, current, pk);
          if (!(limit == null ? void 0 : limit.parent))
            break;
          const parent = limit.parent;
          const parentForecast = forecastOf(parent, pk);
          const requiredValue = flt(
            parentForecast + reserveValue - limit.maxAllowed,
            2
          );
          if (parentForecast > 0 && parentForecast < requiredValue) {
            setForecast(parent, pk, requiredValue);
            const adjKey = `${parent.account}|${dimsKey(parent.dimensions || [])}`;
            if (!adjustmentMap[adjKey]) {
              adjustmentMap[adjKey] = {
                account: parent.account,
                dimensions: (parent.dimensions || []).slice(),
                period_amount_map: {}
              };
              adjusted_parents.push({
                account: parent.account,
                dimensions: (parent.dimensions || []).slice()
              });
            }
            adjustmentMap[adjKey].period_amount_map[pk] = requiredValue;
          }
          if (parentForecast > 0 && parentForecast >= requiredValue) {
            break;
          }
          current = parent;
        }
      }
    }
    for (const key of Object.keys(adjustmentMap)) {
      parent_adjustments.push(adjustmentMap[key]);
    }
    return { parent_adjustments, adjusted_parents };
  }
  function isBudgetReady(frm) {
    var _a, _b, _c;
    return Boolean(((_b = (_a = frm == null ? void 0 : frm.project_budget) == null ? void 0 : _a.rows) == null ? void 0 : _b.length) || ((_c = frm == null ? void 0 : frm.project_budget) == null ? void 0 : _c.table));
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/save.js
  function validateForecastChange(frm, change) {
    var _a;
    const field = change.field;
    if (!(field == null ? void 0 : field.startsWith("actual_")))
      return true;
    const periodKey2 = field.slice("actual_".length);
    const row = change.row;
    if (!row || row.summary_kind)
      return true;
    const value = Number(change.newValue || 0);
    const rows = ((_a = frm.project_budget) == null ? void 0 : _a.rows) || [];
    const childrenSum = childForecastSum(row, periodKey2);
    if (childrenSum > 0 && value < childrenSum) {
      return __(
        "Value cannot be less than the sum of child items ({0})",
        [Math.round(childrenSum).toLocaleString("ru-RU")]
      );
    }
    const parentLimit = parentForecastLimit(rows, row, periodKey2);
    if (parentLimit !== null && value > parentLimit.maxAllowed) {
      return __(
        "Value cannot exceed {0} (parent account '{1}' limit)",
        [
          Math.round(parentLimit.maxAllowed).toLocaleString("ru-RU"),
          parentLimit.parentLabel
        ]
      );
    }
    return true;
  }
  function onValidateCells(frm, { changes }) {
    for (const change of changes) {
      const result = validateForecastChange(frm, change);
      if (result !== true) {
        frappe.msgprint(result);
        return false;
      }
    }
    return true;
  }
  function buildSavePayload(changes) {
    return changes.filter((change) => {
      var _a, _b;
      return ((_a = change.field) == null ? void 0 : _a.startsWith("actual_")) && !((_b = change.row) == null ? void 0 : _b.summary_kind);
    }).map((change) => {
      const periodKey2 = change.field.slice("actual_".length);
      const [year, month] = periodKey2.split("_");
      const row = change.row || {};
      return {
        account: row.account,
        dimensions: row.dimensions || [],
        period_key: periodKey2,
        year: Number(year),
        month: Number(month),
        value: Number(change.newValue || 0)
      };
    }).filter((item) => item.account);
  }
  function patchLocalForecast(frm, changes) {
    var _a, _b;
    const flat = flattenTree(((_a = frm.project_budget) == null ? void 0 : _a.rows) || []);
    for (const change of changes) {
      if (!((_b = change.field) == null ? void 0 : _b.startsWith("actual_")))
        continue;
      const periodKey2 = change.field.slice("actual_".length);
      const row = flat.find((r) => {
        var _a2;
        return r.id === ((_a2 = change.row) == null ? void 0 : _a2.id);
      });
      if (!row)
        continue;
      const value = Number(change.newValue || 0);
      row[`forecast_${periodKey2}`] = value;
      row[`actual_${periodKey2}`] = value;
    }
  }
  async function onSaveCells(frm, { changes }) {
    var _a, _b;
    const payload = buildSavePayload(changes);
    if (!payload.length)
      return true;
    const res = await frappe.xcall(SAVE_FORECAST_API, {
      project: frm.doc.name,
      changes: JSON.stringify(payload)
    });
    if (res == null ? void 0 : res.exc) {
      throw new Error(res.exc);
    }
    frappe.show_alert(__("Data updated successfully"), 5);
    patchLocalForecast(frm, changes);
    if ((_a = window.ProjectBudget) == null ? void 0 : _a.refresh) {
      await window.ProjectBudget.refresh(frm);
    } else if ((_b = window.ProjectBudget) == null ? void 0 : _b.refreshChart) {
      window.ProjectBudget.refreshChart(frm);
    }
    return true;
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/toolbar.js
  function buildToolbarItems(frm) {
    return [
      {
        id: "pl-controls",
        type: "custom",
        render: ({ host }) => {
          const mount = dinext_projects_pl.mount_budget_toolbar_controls;
          if (typeof mount !== "function") {
            console.error("[Project P&L] mount_budget_toolbar_controls missing");
            return;
          }
          mount(frm, $(host));
        }
      }
    ];
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/table.js
  function buildTableOptions(frm, state) {
    var _a;
    return {
      container: state.container,
      data: state.rows,
      columns: getColumns(frm, state.periods),
      summaryRows: state.summaryRows || [],
      summary: { pin: "bottom", edit: false, clipboard: false, selection: false },
      expandedIds: getExpandedIds(frm),
      edit: true,
      selection: { enabled: true },
      clipboard: { enabled: true },
      fillHandle: { enabled: true },
      selectionStatus: { enabled: true },
      rowCheck: { enabled: true, unit: "row", selectAll: true },
      canCheckRow: ({ row }) => !(row == null ? void 0 : row.summary_kind) && !!(row == null ? void 0 : row.account),
      rowReorder: { enabled: false },
      toolbar: {
        persistKey: `project-budget:${((_a = frm.doc) == null ? void 0 : _a.name) || "new"}`,
        items: buildToolbarItems(frm)
      },
      theme: {
        cellHorizontalPadding: 2,
        columnBorder: true,
        headerColumnBorder: true,
        rowBorder: true,
        headerRowBorder: true,
        wrapperBorder: true,
        pinnedColumnBorder: true,
        pinnedRowBorder: true
      },
      onValidateCells: (ctx) => onValidateCells(frm, ctx),
      onSaveCells: (ctx) => onSaveCells(frm, ctx),
      mergeGroup: MERGE_GROUP,
      gridOptions: {
        enableCellSpan: true,
        rowHeight: 29,
        headerHeight: 22,
        groupHeaderHeight: 22
      }
    };
  }
  function applyRuntime(frm, table) {
    attachTreePersistence(frm, table);
    syncExpandedIds(frm);
  }
  async function initTable(frm) {
    const state = initState(frm);
    if (!state.container) {
      return null;
    }
    if (state.table) {
      return state.table;
    }
    if (state._initPromise) {
      return state._initPromise;
    }
    state._initPromise = (async () => {
      try {
        await frappe.require([
          "dinext-table.bundle.js",
          "/assets/dinext_projects_pl/css/project_budget.css"
        ]);
        await loadGridData(frm);
        if (state.table) {
          return state.table;
        }
        const table = await DinextTable.create(buildTableOptions(frm, state));
        state.table = table;
        applyRuntime(frm, table);
        return table;
      } finally {
        state._initPromise = null;
      }
    })();
    return state._initPromise;
  }
  async function refreshRuntime(frm) {
    const state = frm.project_budget;
    if (!(state == null ? void 0 : state.table)) {
      return;
    }
    syncExpandedIds(frm);
    if (state.table.setOption) {
      state.table.setOption("columns", getColumns(frm, state.periods));
    }
    if (state.table.setSummaryRows) {
      state.table.setSummaryRows(state.summaryRows || []);
    }
    if (state.table.refresh) {
      state.table.refresh(state.rows);
    }
  }
  function onTogglePlanOrDelta(frm) {
    applyPlanDeltaVisibility(frm);
  }
  async function onViewOptionsChange(frm) {
    var _a;
    const table = await reloadTable(frm, initTable, refreshRuntime);
    if ((_a = window.ProjectBudget) == null ? void 0 : _a.refreshChart) {
      window.ProjectBudget.refreshChart(frm);
    }
    return table;
  }
  async function onPeriodOrAggregateChange(frm) {
    var _a;
    const table = await reloadTable(frm, initTable, refreshRuntime);
    if ((_a = window.ProjectBudget) == null ? void 0 : _a.refreshChart) {
      window.ProjectBudget.refreshChart(frm);
    }
    return table;
  }
  async function onToggleDimensions(frm) {
    var _a, _b;
    const state = frm.project_budget;
    const container = state == null ? void 0 : state.container;
    if ((_a = state == null ? void 0 : state.table) == null ? void 0 : _a.destroy) {
      state.table.destroy();
    }
    if (state) {
      state.table = null;
      state._initPromise = null;
      if (container) {
        state.container = container;
      }
    }
    const table = await reloadTable(frm, initTable, refreshRuntime);
    if ((_b = window.ProjectBudget) == null ? void 0 : _b.refreshChart) {
      window.ProjectBudget.refreshChart(frm);
    }
    return table;
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/mount.js
  var TABLE_CLASS = "budget-table";
  var FIELD = "custom_planning";
  function resolveTableContainer(wrapper) {
    let $table = wrapper.find(`.${TABLE_CLASS}`).first();
    if (!$table.length) {
      $table = $(`<div class="${TABLE_CLASS}"></div>`).appendTo(wrapper);
    }
    const el = $table[0];
    if (el) {
      el.style.height = "min(50vh, 560px)";
      el.style.minHeight = "280px";
      el.style.width = "100%";
    }
    return el || null;
  }
  async function ensureMounted(frm) {
    var _a;
    const field = frm.get_field(FIELD);
    if (!((_a = field == null ? void 0 : field.$wrapper) == null ? void 0 : _a.length)) {
      return;
    }
    const container = resolveTableContainer(field.$wrapper);
    if (!container) {
      return;
    }
    const state = initState(frm);
    state.container = container;
    if (state._mountPromise) {
      return state._mountPromise;
    }
    state._mountPromise = (async () => {
      var _a2, _b;
      try {
        if (state.table) {
          await reloadTable(frm, initTable, refreshRuntime);
        } else {
          await initTable(frm);
        }
        (_b = (_a2 = window.ProjectBudget) == null ? void 0 : _a2.refreshChart) == null ? void 0 : _b.call(_a2, frm);
      } finally {
        state._mountPromise = null;
      }
    })();
    return state._mountPromise;
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/selection.js
  var SAVE_PLAN_API = "dinext_projects_pl.dinext_projects_pl.budget_approval.service.save_budget_plan_for_approval";
  function getSelectedRows(frm) {
    var _a;
    const table = (_a = frm.project_budget) == null ? void 0 : _a.table;
    if (!(table == null ? void 0 : table.getCheckedRows)) {
      return [];
    }
    return table.getCheckedRows().filter((row) => row && !row.summary_kind && row.account);
  }
  function buildSavePlanPayload(frm) {
    var _a, _b, _c;
    const selected = getSelectedRows(frm);
    const periods = ((_a = frm.project_budget) == null ? void 0 : _a.periods) || [];
    const data = [];
    for (const row of selected) {
      const amounts = [];
      for (const period of periods) {
        const key = period.key;
        const planValue = period.is_past ? Number((_b = row[`own_fact_${key}`]) != null ? _b : 0) : Number((_c = row[`forecast_${key}`]) != null ? _c : 0);
        if (planValue > 0) {
          amounts.push({
            year: period.year,
            month: period.month,
            plan_value: planValue
          });
        }
      }
      if (!amounts.length)
        continue;
      data.push({
        account: row.account,
        dimensions: row.dimensions || [],
        amounts
      });
    }
    return data;
  }
  async function executeSavePlan(frm, data) {
    var _a;
    const res = await frappe.xcall(SAVE_PLAN_API, {
      project: frm.doc.name,
      data: JSON.stringify(data)
    });
    if (res == null ? void 0 : res.exc) {
      throw new Error(res.exc);
    }
    const mode = (res == null ? void 0 : res.mode) || "approval";
    const successMessage = mode === "direct" ? __("Plan saved") : __("Budgets submitted for approval");
    frappe.show_alert(successMessage, 5);
    if (typeof load_and_render_project_dashboard === "function") {
      load_and_render_project_dashboard(frm);
    }
    if ((_a = window.ProjectBudget) == null ? void 0 : _a.refresh) {
      await window.ProjectBudget.refresh(frm);
    }
  }
  function saveForecastAsPlan(frm) {
    if ((frm._pl_period_type || "month") !== "month") {
      frappe.msgprint(
        __("Saving plan is available only in monthly display mode.")
      );
      return;
    }
    const v2Selected = getSelectedRows(frm);
    if (!v2Selected.length) {
      frappe.msgprint(
        __("Select the rows for which plan data should be saved.")
      );
      return;
    }
    const data = buildSavePlanPayload(frm);
    if (!data.length) {
      frappe.msgprint(__("No data to save."));
      return;
    }
    frappe.confirm(
      __(
        "Are you sure you want to save the current forecast / actual data as plan?"
      ),
      () => {
        executeSavePlan(frm, data).catch((err) => {
          frappe.msgprint(__("Error saving plan"));
          console.error(err);
        });
      },
      () => frappe.show_alert(__("Operation cancelled"), 3)
    );
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/chart-adapter.js
  function toFloat(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function rowPeriodAmount(row, periodKey2, valueKey) {
    const field = valueKey === "fact" ? `own_fact_${periodKey2}` : `${valueKey}_${periodKey2}`;
    const direct = toFloat(row == null ? void 0 : row[field]);
    if (direct) {
      return direct;
    }
    let total = 0;
    for (const child of (row == null ? void 0 : row.children) || []) {
      total += rowPeriodAmount(child, periodKey2, valueKey);
    }
    return total;
  }
  function calcPeriodIncomeExpense(rootRows, period) {
    const key = period.key || `${period.year}_${period.month}`;
    const actualKey = period.is_past ? "fact" : "forecast";
    let plan_income = 0;
    let plan_expenses = 0;
    let actual_income = 0;
    let actual_expenses = 0;
    for (const row of rootRows || []) {
      const plan = rowPeriodAmount(row, key, "plan");
      const actual = rowPeriodAmount(row, key, actualKey);
      const rtype = row.root_type || "";
      if (rtype === "Expense") {
        plan_expenses += plan;
        actual_expenses += actual;
      } else if (rtype === "Income") {
        plan_income += plan;
        actual_income += actual;
      }
    }
    return { plan_income, plan_expenses, actual_income, actual_expenses };
  }
  function buildChartData(frm) {
    var _a, _b;
    const periods = (_a = frm.project_budget) == null ? void 0 : _a.periods;
    const rows = (_b = frm.project_budget) == null ? void 0 : _b.rows;
    if (!(periods == null ? void 0 : periods.length) || !(rows == null ? void 0 : rows.length)) {
      return null;
    }
    const labels = periods.map(
      (p) => p.label || (p.quarter ? `Q${p.quarter} ${p.year}` : p.month ? `${p.year}-${String(p.month).padStart(2, "0")}` : String(p.year))
    );
    const plan_income = [];
    const actual_income = [];
    const plan_expenses = [];
    const actual_expenses = [];
    const profit_plan = [];
    const profit_actual = [];
    for (const period of periods) {
      const r = calcPeriodIncomeExpense(rows, period);
      plan_income.push(parseFloat(r.plan_income.toFixed(2)));
      actual_income.push(parseFloat(r.actual_income.toFixed(2)));
      plan_expenses.push(parseFloat((-r.plan_expenses).toFixed(2)));
      actual_expenses.push(parseFloat((-r.actual_expenses).toFixed(2)));
      profit_plan.push(parseFloat((r.plan_income - r.plan_expenses).toFixed(2)));
      profit_actual.push(parseFloat((r.actual_income - r.actual_expenses).toFixed(2)));
    }
    const cumulative_profit_plan = [];
    const cumulative_profit_actual = [];
    const cumulative_income_plan = [];
    const cumulative_income_actual = [];
    const cumulative_expenses_plan = [];
    const cumulative_expenses_actual = [];
    let cumP = 0;
    let cumA = 0;
    let cumIncomePlan = 0;
    let cumIncomeActual = 0;
    let cumExpensesPlan = 0;
    let cumExpensesActual = 0;
    for (let i = 0; i < profit_plan.length; i++) {
      cumP += profit_plan[i];
      cumA += profit_actual[i];
      cumIncomePlan += plan_income[i];
      cumIncomeActual += actual_income[i];
      cumExpensesPlan += plan_expenses[i];
      cumExpensesActual += actual_expenses[i];
      cumulative_profit_plan.push(parseFloat(cumP.toFixed(2)));
      cumulative_profit_actual.push(parseFloat(cumA.toFixed(2)));
      cumulative_income_plan.push(parseFloat(cumIncomePlan.toFixed(2)));
      cumulative_income_actual.push(parseFloat(cumIncomeActual.toFixed(2)));
      cumulative_expenses_plan.push(parseFloat(cumExpensesPlan.toFixed(2)));
      cumulative_expenses_actual.push(parseFloat(cumExpensesActual.toFixed(2)));
    }
    return {
      labels,
      plan_income,
      actual_income,
      plan_expenses,
      actual_expenses,
      profit_plan,
      profit_actual,
      cumulative_profit_plan,
      cumulative_profit_actual,
      cumulative_income_plan,
      cumulative_income_actual,
      cumulative_expenses_plan,
      cumulative_expenses_actual,
      periods,
      source: "project_budget"
    };
  }
  function refreshChart(frm) {
    if (typeof globalThis.render_pl_chart_impl === "function") {
      globalThis.render_pl_chart_impl(frm, false);
    } else if (typeof render_pl_chart === "function") {
      render_pl_chart(frm, false);
    }
  }

  // ../dinext_projects_pl/dinext_projects_pl/public/js/project_budget/index.js
  var ready = false;
  var ProjectBudget = {
    isReady() {
      return ready;
    },
    ensureMounted,
    destroy(frm) {
      destroyTable(frm);
    },
    async refresh(frm) {
      const table = await reloadTable(frm, initTable, refreshRuntime);
      refreshChart(frm);
      return table;
    },
    refreshColumns,
    applyPlanDeltaVisibility,
    onTogglePlanOrDelta,
    onToggleDimensions,
    onPeriodOrAggregateChange,
    onViewOptionsChange,
    getSelectedRows,
    buildSavePlanPayload,
    saveForecastAsPlan,
    buildChartData,
    refreshChart,
    isBudgetReady,
    getDisplayPeriods,
    accountAllowsTask,
    getBasisForecastMap,
    buildParentAdjustments: buildParentAdjustmentsFromUpdates
  };
  ready = true;
  window.ProjectBudget = ProjectBudget;
  installLazyTabMountApi();
})();
//# sourceMappingURL=project-budget.bundle.VFXFN4B7.js.map
