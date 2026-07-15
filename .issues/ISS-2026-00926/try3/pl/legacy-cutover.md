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
| 0.1 | Срезы 1–7 (shell → chart adapter) + UI polish | ✅ |
| 0.2 | Clipboard enabled (`clipboard` + `fillHandle`) | ✅ код; smoke вручную ⏳ |
| 0.3 | Dual-table smoke на `TEST-V15.106.0 (HEAD)` (числа, summary, edit, save plan, toggles, chart) | ⏳ |
| 0.4 | Решение по `hide_empty` на v2 (сделать или явно out-of-scope cutover) | ⏳ |

Пока 0.3 не зелёный — **не** выключать Sticky P&L и **не** удалять файлы.

---

## 1. Карта поверхностей (сейчас — dual)

```text
Project → custom_planning
├── .budget-controls          ← shared (toggles, view options, save plan)
├── .budget-table             ← LEGACY StickyDataTable (frm.budget_dt)
├── .project-pl-v2-section    ← TEMP dual
│     badge «P&L v2 (preview)»
│     └── .budget-table-v2    ← DinextTable (frm.pl_v2)
├── chart (custom_pl_chart)   ← echarts; source prefers pl_v2 via chart-adapter
└── financial metrics / dashboard
```

| Символ | Где |
|--------|-----|
| Entry | `public/js/project_pl.js` → `render_budget_table` |
| Flag | `frm._pl_v2_enabled` (default `true` в dual-preview-mount) |
| Bridge | `v2-preview-bridge.js` → `frappe.require(pl-v2.bundle.js)` → `ProjectPlV2` |
| Legacy data | `frm.aggregatedBudget` ← client `load_budget_data` |
| v2 data | `get_pl_grid_v2` → `frm.pl_v2.rows` / `summaryRows` / `periods` |
| Chart | `project_pl_echarts.js` → `build_pl_chart_data` → **сначала** `ProjectPlV2.buildChartData`, иначе aggregatedBudget |
| Save forecast | v2 → `pl_v2_save_forecast_changes`; legacy → jQuery cell path |
| Save plan | button → v2 `saveForecastAsPlan` если есть selection, иначе legacy checked rows |

### hooks.py (сейчас)

```text
doctype_js Project:
  project_pl_navigation.js
  project_pl_style.js
  project_pl/v2-preview-bridge.js   ← TEMP
  project_pl.js                     ← legacy Sticky + dual mount hook
  project_pl_calc.js
  project_pl_echarts.js
  project_pl_financial_metrics.js
  project_pl_dashboard.js

doctype_css Project:
  public/css/pl-v2.css
```

---

## 2. Зависимости v2 от legacy (важно)

| Модуль | Тянет legacy | Действие на cutover |
|--------|--------------|---------------------|
| `v2/save.js` | `load_budget_data` после forecast save | оставить refresh legacy **или** только `ProjectPlV2.refresh` + chart |
| Chart | fallback `aggregatedBudget` | после cutover fallback мёртв — только adapter |
| Controls / toggles | живут в `project_pl.js` | **оставить** shared; вызовы `get_pl_v2_preview()?.…` → прямой `ProjectPlV2` |
| `project_pl_calc.js` | `calc_column_total`, indexes | нужен, пока chart/legacy path; после cutover — только если кто-то ещё зовёт |
| `project_pl_style.js` | CSS Sticky `.budget-table` | удалить Sticky-правила; controls/chart CSS оставить |
| Dashboard / metrics | могут читать aggregatedBudget | проверить grep; перевести на v2/API при необходимости |
| Forecast dropdown («Добавить прогноз») | пишет в budget → `load_budget_data` | после save: `ProjectPlV2.refresh` + chart |

**Вывод:** cutover ≠ удалить весь `project_pl.js`. Сначала «v2-only UI», потом снос Sticky-only, потом decoupling `aggregatedBudget`.

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

| Шаг | Действие |
|-----|----------|
| P3.1 | Chart: только `ProjectPlV2.buildChartData` (убрать legacy branch в `build_pl_chart_data`) |
| P3.2 | Удалить/сузить `load_budget_data` если никто не читает `aggregatedBudget` |
| P3.3 | Dashboard / metrics — grep `aggregatedBudget`, перевести |
| P3.4 | `project_pl_calc.js` — оставить только то, что ещё нужно вне таблицы |
| P3.5 | Обновить `index.md` / этот файл — cutover ✅ |

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
