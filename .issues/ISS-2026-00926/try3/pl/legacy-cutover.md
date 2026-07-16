# Legacy cutover — Project P&L → DinextTable (v2)

> Дата: 2026-07-15  
> Scope: таблица Budget / P&L на форме Project (`custom_planning`)  
> Целевой UI: `public/js/project_pl/v2/` + `pl-v2.bundle.js` + `pl-v2.css`  
> Образец фаз: [`../we/legacy-cutover.md`](../we/legacy-cutover.md)  
> Статус срезов: [`index.md`](index.md)

**Не трогает:** Budget vs Forecast report, sticky-datatable в `dinext_common` (нужен другим surface), backend approval APIs кроме путей, которые уже зовёт v2.

---

## 0. Предусловия

| # | Условие | Статус |
|---|---------|--------|
| 0.1 | Срезы 1–8 + UI polish | ✅ |
| 0.2 | Clipboard enabled (`clipboard` + `fillHandle`) | ✅ код; smoke вручную ⏳ |
| 0.3 | **P1 v2-only mount** (одна таблица в `.budget-table`) | ✅ |
| 0.4 | Smoke P1 на `TEST-V15.106.0 (HEAD)` | ✅ 2026-07-16 |
| 0.5 | **P2** remove dual/bridge/Sticky init | ✅ код 2026-07-16 |
| 0.6 | Smoke P2 (после redis FLUSH + backend restart) | ✅ 2026-07-16 |
| 0.7 | P3.4 dead Sticky helpers вырезаны + smoke | ✅ 2026-07-16 |
| 0.8 | Cleanup pass: kill-switch / dead stubs / WE sync | ✅ 2026-07-16 |
| 0.9 | Risk + pl-from-we rewrite on `pl_v2` (no adapter) | ✅ 2026-07-16 |
| 0.10 | Delete `project_pl_calc.js` + tests | ✅ 2026-07-16 |
| 0.11 | `hide_empty` на v2 | ❌ drop (2026-07-16) — не делаем |

---

## 1. Карта поверхностей (P2 — v2-only, Sticky init удалён)

```text
Project → custom_planning
├── .budget-controls          ← shared (toggles, view options, save plan)
├── .budget-table             ← DinextTable (frm.pl_v2)
├── chart (custom_pl_chart)   ← echarts; source = pl_v2 chart-adapter
└── financial metrics / dashboard
```

| Символ | Где |
|--------|-----|
| Entry | `public/js/project_pl.js` → `render_budget_table` |
| Bootstrap | `v2-entry.js` → `frappe.require(pl-v2.bundle.js)` → `ProjectPlV2` |
| Mount | `v2/mount.js` → `.budget-table` |
| v2 data | `get_pl_grid_v2` → `frm.pl_v2.rows` / `summaryRows` / `periods` |
| Chart | `build_pl_chart_data` → `ProjectPlV2.buildChartData` |
| Save forecast | `pl_v2_save_forecast_changes` |
| Save plan | `saveForecastAsPlan` |

Cross-app refresh: `refresh_project_pl(frm)` (+ alias `updateTaskDimension` для WE).

### hooks.py (сейчас)

```text
doctype_js Project:
  project_pl_navigation.js
  project_pl_style.js
  project_pl/v2-entry.js            ← bootstrap ProjectPlV2
  project_pl.js                     ← controls + mount v2
  project_pl_echarts.js
  project_pl_financial_metrics.js
  project_pl_dashboard.js

doctype_css Project:
  public/css/pl-v2.css
```

---

## 2. Зависимости v2 (после cutover)

| Модуль | Источник | Статус |
|--------|----------|--------|
| Table / save / chart | `ProjectPlV2` + `pl_v2` | ✅ |
| Risk / WE parent-adjust | `budget-tree.js` helpers | ✅ |
| Controls / toggles | `project_pl.js` → `ProjectPlV2` | ✅ |
| `project_pl_calc.js` | — | ✅ удалён |
| Sticky / `aggregatedBudget` | — | ✅ UI path нет |

---

## 3. Что удалять / что оставлять

### Удалить (после smoke + v2-only mount)

| Путь / фрагмент | Почему |
|-----------------|--------|
| `public/js/project_pl/v2-preview-bridge.js` | TEMP dual bridge |
| `public/js/project_pl/v2/dual-preview-mount.js` | TEMP section/badge |
| Sticky init в `project_pl.js` (`new StickyDataTable`, `frm.budget_dt`) | legacy grid |
| HTML formatters: `budget_cell`, `budget_group`, `columnTotal` hooks | composite HTML |
| jQuery inline-edit forecast на `.budget-table` | заменён `v2/save.js` |
| Dual CSS: `.project-pl-v2-section`, `.project-pl-v2-badge`, dashed border | preview chrome |
| Класс `.budget-table-v2` → mount в основной контейнер (или rename → `.budget-table`) | единый DOM |

### Оставить

| Путь | Почему |
|------|--------|
| `public/js/project_pl/v2/**` (кроме dual-preview) | целевой UI |
| `…/project_pl/v2/*.py` + API | grid / save forecast |
| Controls в `project_pl.js` (кнопки, view options) — вынести при желании в `controls.js` | shared |
| `project_pl_echarts.js` | chart; source = adapter |
| `project_pl_calc.js` | пока нужны helpers вне Sticky; потом подчистить |
| `project_pl_style.js` (не-Sticky части) | layout controls/chart |
| `project_pl_navigation.js`, dashboard, financial metrics | другие виджеты |
| `budget_approval` / save plan API | v2 selection уже зовёт |
| Budget vs Forecast report | отдельный surface |
| `dinext_common` dinext-table + sticky (для других apps) | не сносить |

---

## 4. Фазы наката

### Фаза P0 — Smoke dual (без удаления)

На `dev.dinext.localhost`, Project `TEST-V15.106.0 (HEAD)`:

```text
[ ] Числа plan/actual/Δ/Итого ↔ legacy (вкл. «Показать план»)
[ ] Summary прибыль / рентабельность / Итого
[ ] Tree expand + persist
[ ] Edit future forecast → save → оба грида + chart
[ ] Toggle plan / Δ / view options
[ ] Save plan (checkbox selection) — own_fact past, forecast future
[ ] Clipboard: Ctrl+C TSV → Excel; Ctrl+V в editable forecast
[ ] Fill-handle протяжка
[ ] Chart source = pl_v2 (build_pl_chart_data.source)
[ ] hide_empty: либо v2 поддерживает, либо зафиксировано «legacy-only до follow-up»
```

**Rollback:** dual как есть, файлы не трогали.

---

### Фаза P1 — v2-only mount (флаг, файлы ещё живы)

Цель: на форме **одна** таблица — DinextTable. Sticky не создаётся.

| Шаг | Действие |
|-----|----------|
| P1.1 | `render_budget_table`: не создавать `StickyDataTable`; контейнер `.budget-table` → mount v2 |
| P1.2 | Убрать dual section/badge (mount без preview chrome) |
| P1.3 | Kill-switch: `frm._pl_v2_enabled = false` или site_config → legacy path **пока файлы живы** |
| P1.4 | hooks: legacy JS ещё можно грузить (dead), UI path только v2 |
| P1.5 | После save forecast/plan — только `ProjectPlV2.refresh` + chart (не обязательно `load_budget_data`) |
| P1.6 | Smoke повторно **без** side-by-side |

**Rollback:** вернуть Sticky init + dual (git revert P1) или kill-switch.

---

### Фаза P2 — Удалить dual / Sticky P&L-only

Только после зелёного P1 smoke на demodev/test (по договорённости).

| Шаг | Действие | verify |
|-----|----------|--------|
| P2.1 | Удалить `v2-preview-bridge.js`, `v2/dual-preview-mount.js` | grep 0 |
| P2.2 | hooks: entry = bundle require + mount (без bridge) | Project load |
| P2.3 | Вырезать Sticky init + HTML cell path из `project_pl.js` | нет `frm.budget_dt` |
| P2.4 | Почистить Sticky CSS в `project_pl_style.js` | нет `.budget-table .datatable` rules |
| P2.5 | Strip dual CSS из `pl-v2.css` | нет badge/section |
| P2.6 | `bench build --app dinext_projects_pl` + `clear-cache` site | UI ок |

**Grep перед rm:**

```text
StickyDataTable
budget_dt
budget-table-v2
v2-preview-bridge
dual-preview-mount
P&L v2 (preview)
budget_cell(
columnTotal
editable-forecast
bg-group-
```

---

### Фаза P3 — Decouple `aggregatedBudget`

| Шаг | Действие | Статус |
|-----|----------|--------|
| P3.1 | Chart: только `ProjectPlV2.buildChartData` | ✅ 2026-07-16 |
| P3.2 | `load_budget_data` / `updateBudgetTable` / `updateTaskDimension` → v2 refresh | ✅ |
| P3.3 | Dashboard / metrics — grep `aggregatedBudget` | ✅ нет ссылок |
| P3.4 | Dead Sticky helpers (`budget_cell*`, `refreshBudget`, …) | ✅ вырезаны из `project_pl.js` |
| P3.5 | `project_pl_calc.js` deleted + docs | ✅ 2026-07-16 |
| P3.6 | `load_budget_data` → `refresh_project_pl` | ✅ 2026-07-16 |

API `get_pl_grid_v2` / `pl_v2_save_forecast_changes` / save plan **не** удалять.

---

### Фаза P4 — Docs / ops

```text
[ ] pl/index.md — dual → v2-only
[ ] Этот файл — фазы done
[ ] try3/index.md — P&L cutover note
[ ] Deploy: build + clear-cache на target site (не смешивать sites)
```

---

## 5. Порядок безопасного наката (кратко)

```text
1. P0 smoke dual          →  verify: чеклист §4
2. P1 v2-only mount       →  verify: одна таблица, kill-switch работает
3. Наблюдение 1–2 дня     →  demodev/test
4. P2 удалить Sticky/dual →  verify: grep + UI
5. P3 decouple aggregate  →  verify: chart/metrics
6. P4 docs/ops
```

**Rollback на каждом шаге:** git revert фазы или kill-switch до P2; после P2 — revert commit + rebuild.

---

## 6. Явный non-goals cutover

- Не удалять StickyDataTable из `dinext_common`
- Не трогать Budget vs Forecast report в том же PR
- Не блокировать cutover на полный GL-dim parity, если P0 smoke зелёный и gap задокументирован
- `hide_empty`: либо отдельный маленький PR до P1, либо follow-up после P2
