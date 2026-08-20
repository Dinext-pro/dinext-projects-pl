# Legacy P&L — inventory

> Поверхностный срез для планирования v2. Детальный аудит — по старту каждой фазы.

## Текущий стек

| Слой | Файлы | Заметки |
|------|-------|---------|
| Render / init | `public/js/project_pl.js` → `render_budget_table` | StickyDataTable, `.budget-table` |
| Styles | `project_pl_style.js` | Nested CSS string + `.editable-forecast` |
| Calc / chart | `project_pl_calc.js`, `project_pl_echarts.js` | Читают `frm.aggregatedBudget` |
| Metrics / dashboard | `project_pl_financial_metrics.js`, `project_pl_dashboard.js` | Отдельный контур |
| Navigation | `project_pl_navigation.js` | Scroll к `.budget-table` |
| Backend (частично) | `financial_metrics/`, `budget_approval/`, BVF report | Нет dedicated Project-tab grid API |
| Grid lib | StickyDataTable | legacy |

## API / persistence (сейчас)

| Операция | Как сейчас | Проблема для v2 |
|----------|------------|-----------------|
| Чтение таблицы | Клиентский `load_budget_data` + `frappe.db` / get_doc | Тяжёлая логика на клиенте, `dimension_data[]` |
| Сохранение прогноза | jQuery click → `saveBudgetForecastInput` | DOM edit, не batch grid |
| Save plan | `save_bg_forecast_as_plan` | Ок как batch-источник |
| Totals | `hooks.columnTotal` HTML | Не `summaryRows` |
| Chart | `render_pl_chart` ← `aggregatedBudget` | Нужен adapter на v2 rows |

## Фичи legacy (что переносим)

| # | Фича | Приоритет v2 |
|---|------|--------------|
| 1 | Дерево счетов (expand/collapse) | P0 |
| 2 | Периоды месяц: plan / forecast\|fact / delta | P0 — scalar |
| 3 | Dimensions buckets | P0 — rows+merge |
| 4 | Summary: прибыль / рентабельность | P0 — `summaryRows` |
| 5 | Редактирование forecast | P0 — `onSaveCells` |
| 6 | View options (forecast/fact/both) | P1 |
| 7 | Toggle план / Δ / пустые строки | P1 |
| 8 | Checkbox + «Сохранить план» | P1 |
| 9 | Меню «Добавить прогноз» | P1 — shared controls |
| 10 | Chart sync | P2 |
| 11 | Dashboard / financial metrics | P2 — не блокирует grid |
| 12 | Clipboard / fill | P3 — из коробки DinextTable |
| 13 | Risk dimension rows | P2 |

## Anti-patterns → выбрасываем

| Anti-pattern | Замена v2 |
|--------------|-----------|
| `budget_cell` HTML с plan/actual/delta | 3 scalar колонки |
| `$(document).on('click', '.editable-forecast')` | `onSaveCells` / grid editors |
| `columnTotal` HTML profit/profitability | `summaryRows` |
| `frm.budget_dt.datamanager` как SoT | `frm.pl_v2` + grid API |
| ForecastDom / DinextAgGrid presets (если появятся) | не тащить; сразу DinextTable |

## Baseline

Числа dual-table сравнивать с legacy на одном Project (dev.dinext.localhost).  
BVF report — отдельный контур; не блокирует Project-tab v2.
