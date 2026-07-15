# P&L → DinextTable (try3)

## Цель

Переписать таблицу **Project P&L / Budget** на `DinextTable` (AG Grid 35, scalar model). Бизнес-логику сохранить. Legacy anti-patterns (composite HTML plan/forecast/Δ, jQuery inline-edit) — отбросить.

## Принципы

| Принцип | Смысл |
|---------|--------|
| Greenfield слоями | Новый UI + API v2 рядом со старым; cutover только после parity |
| Scalar contract | 1 ячейка = 1 значение; dimensions — строки/merge, не HTML stack |
| Domain в app | Rollup, save, totals — Python + тонкий клиент; ядро не ветвим |
| Пошаговые фазы | Каждая фича — отдельная фаза с критерием готовности на dual-table |
| Образец внедрения | `try3/we/` — dual-table + `v2/` **каркас**, не домен WE |

## Ветка

| Репо | Ветка | База |
|------|-------|------|
| `dinext_projects_pl` | `ISS-2026-00926-try3` | `ISS-2026-00418` (StickyDataTable P&L) |

Ядро: `dinext_common` / `ISS-2026-00926-try3`.

---

## Статус (2026-07-15) — читать первым

### Что есть сейчас

| Слой | Статус | Путь |
|------|--------|------|
| Legacy UI | работает | `public/js/project_pl.js` + StickyDataTable |
| **Backend v2** | **оставить / дорабатывать** | `dinext_projects_pl/.../project_pl/v2/*.py` |
| **Client v2 UI** | **Фаза 4 ✅** | shell + data + scalar period/total columns (parity legacy layout, atomic) |
| Bridge / hooks / CSS v2 | ✅ | `v2-preview-bridge.js`, `pl-v2.css`, hooks |
| Cutover | запрещён | пока нет parity |

### Почему снесли клиент

Первый проход `public/js/project_pl/v2/` получился грязным: параллельные агенты, фичи «проведены» без единого контракта head/tail/save/chart, docs завышали готовность. Решение: **переписать клиент с нуля по WE-каркасу**, backend v2 не выкидывать.

### Backend v2 — что уже ценно (не переписывать без нужды)

API:

- `get_pl_grid_v2`
- `pl_v2_save_forecast_changes`

Уже в коде (проверить перед использованием):

- fingerprint **без `:`** (`doc\x1fdocname`) — иначе ломается tree path ядра
- always empty-dim merge head; Risk/Task — sibling tails
- parent rollup в head: только `fact_*` (как legacy)
- head amounts = empty bucket + sum dim tails (display total)
- `summary_rows` profit / profitability

Известные gaps backend (не закрыты):

- GL dimensions пока узко (Task-centric) vs legacy full accounting dims
- Task как dim-row, не legacy task-tree
- hide_empty / полный parity leaf vs legacy — не golden-tested
- profitability Δ формула может отличаться от legacy

### Client rewrite — следующий шаг

**Сделать заново** `public/js/project_pl/v2/` одним потоком (не параллелить на одни файлы).

Референс структуры:  
`frappe-bench/apps/project_workload_assignment/.../public/js/work_efforts/v2/`  
(mount, data, table, columns, tree persist, selection, save, index, bundle).

Порядок вертикальных срезов + DoD на `TEST-V15.106.0 (HEAD)` dual-table:

1. Shell dual-preview + empty `DinextTable` + hooks/CSS ✅  
2. `get_pl_grid_v2` → rows/columns/summary (read-only) ✅  
3. Tree expand + default roots + persist ✅  
4. Edit forecast → `pl_v2_save_forecast_changes` ✅  
5. Toggles plan/Δ / view options ✅  
6. Selection + save plan (только выбранный bucket, **не** rolled head totals) ✅  
7. Chart adapter ✅ (`chart-adapter.js` → `build_pl_chart_data` prefers `pl_v2`)  
8. Clipboard ✅ (`clipboard` + `fillHandle` on); smoke — Ctrl+C/V / fill (чеклист в cutover)  
9. Cutover — план: [`legacy-cutover.md`](legacy-cutover.md)  
Открыто до cutover: dual smoke P0, `hide_empty` на v2

**DoD среза:** числа/поведение сверять с legacy `.budget-table` на том же Project, не «файл появился».

### Dual-table (после появления клиента)

```
controls
├── .budget-table       ← legacy (не трогать до cutover)
├── .budget-table-v2    ← DinextTable preview
└── chart / dashboard
```

Флаг: `frm._pl_v2_enabled`.

---

## Документы

| Файл | Назначение |
|------|------------|
| [`implementation-plan.md`](implementation-plan.md) | Фазы (исторический план; статус — этот index) |
| [`legacy-inventory.md`](legacy-inventory.md) | Аудит legacy |
| [`decisions.md`](decisions.md) | ADR (+ D8 client rewrite) |

## Связь

- WE образец: [`../we/`](../we/)
- try3 overview: [`../index.md`](../index.md)
- DinextTable: `dinext_common/public/js/table/README.md`
