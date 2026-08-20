# ADR — P&L v2

## Зафиксировано

### D1. Greenfield рядом с legacy

До cutover legacy `StickyDataTable` (`.budget-table`) не меняем. Новый код — `public/js/project_pl/v2/` + отдельный DOM `.budget-table-v2`.

### D2. Scalar period model

**1 период = 3 поля/колонки:** `plan_YYYY_M`, `forecast_YYYY_M` | `fact_YYYY_M`, `delta_YYYY_M`.

Не composite HTML `budget-group` с тремя `<div>` в одной ячейке.

Toggle «Скрыть план / Δ» → `columnApi` visibility, не пересборка HTML.

### D3. Строки = дерево как legacy (без merge) — rev. 2026-07-15

Дерево как StickyDataTable после `updateTaskDimension` / `addRiskDimensionRows`:

- CoA (P&L accounts)
- под статьями с allowed dimension Task — все Task проекта (как WE consolidated)
- Project Risk — дочерние строки `⚠ …`

**Без** cell merge / `merge_group_*` / dim-tails-as-siblings.

Единственное отличие UI от legacy по периодам: composite ячейка → 3 leaf (`plan` | `actual` | `Δ`).

O1 закрыт: не column-groups, не WE-style merge.

### D4. Summary через ядро — wired 2026-07-15

«Валовая прибыль» / «Рентабельность» → `summaryRows` + `summary.pin: "bottom"`, не HTML в StickyDataTable `columnTotal`.

Суммы периода: как legacy `get_row_period_total` — direct nonzero, иначе walk descendants (`plan` / `actual`).

Гайд: `sections-and-summary.md`.

### D9. Fact rollup (display)

На дереве v2: `fact_*` снизу вверх в scalar родителя (после split Task/Risk).  
Plan/forecast на родителе — только own buckets (как legacy cell).  
Summary отдельно ходит в потомков, если direct = 0.

### D10. Tree UX + forecast edit (2026-07-15)

- Default expand = legacy `setTreeDepth(1)` (корни раскрыты); persist `frm._pl_v2_expanded_ids`.
- Edit: future `actual_*` → `pl_v2_save_forecast_changes` (account × dimensions × period).
- После save: refresh v2 + `load_budget_data` (dual-table).

### D11. Save plan from selection (2026-07-15)

- Кнопка «Сохранить план» → v2 `saveForecastAsPlan` (если есть `_selected` в v2), иначе legacy checked rows.
- Payload: `account` + `dimensions` + amounts; past = `own_fact_*` (не rolled `fact_*`), future = `forecast_*`.
- API: существующий `save_budget_plan_for_approval`.

### D5. Backend v2 — отдельные методы

API namespace `project_pl.v2`:

- `get_pl_grid_v2`
- `pl_v2_save_forecast_changes`
- save plan — существующий `budget_approval.service.save_budget_plan_for_approval`

Legacy клиентский `load_budget_data` / `frappe.db` path не ломаем.

### D6. Feature CSS в app

Стили — `dinext_projects_pl/public/css/pl-v2.css`, не в `dinext-table.css`.

### D7. Ветка

`dinext_projects_pl` → `ISS-2026-00926-try3` от актуального StickyDataTable-кода (`ISS-2026-00418`), **не** от WIP DinextAgGrid на `ISS-2026-00926`.

### D8. Client rewrite (2026-07-15)

Первый клиентский `public/js/project_pl/v2/` **удалён** (грязный черновик после параллельных агентов).

- **Оставить:** Python `project_pl/v2/` (API + grid contract).
- **Писать заново:** весь JS/CSS dual-preview клиента по каркасу WE (`work_efforts/v2/`), одним потоком, DoD = dual-table parity на тестовом Project.
- Не восстанавливать старые `selection.js` / `chart-adapter.js` / `tree.js` из WIP — копировать паттерны из WE, домен из backend + legacy inventory.

---

## Открыто (решить до фазы)

| # | Вопрос | Фаза |
|---|--------|------|
| O1 | ~~Dimensions: rows+merge vs column groups~~ → **D3: legacy tree, no merge** | closed |
| O2 | ~~Delta: server vs client~~ → **server `delta_*`** | closed |
| O3 | Fact vs forecast в одной колонке `actual_*` или раздельно | 4 — сейчас `actual_*` |
| O4 | ~~server vs aggregatedBudget adapter~~ → **server `get_pl_grid_v2`** | closed |
| O5 | Флаг v2: always-on / localStorage / System Settings | 0 (сейчас always-on dev) |
| O6 | Head display total vs save payload: save только leaf/bucket, не rolled head | 8 / 10 |
