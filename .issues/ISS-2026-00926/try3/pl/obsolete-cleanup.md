# Obsolete cleanup — Project P&L after DinextTable cutover

> Дата: 2026-07-16  
> Подход: **rewrite consumers on pl_v2**, не adapter к `aggregatedBudget`

## Done

- P&L UI cutover (Sticky removed)
- Kill-switch / dead stubs removed
- WE sync → `ProjectPlV2.refresh`
- **Risk reserves** → `ProjectPlV2` tree helpers (`budget-tree.js`)
- **pl-from-we parent-adjust** → `ProjectPlV2.buildParentAdjustments`
- **`project_pl_calc.js` removed** from hooks + deleted

## Remaining (optional)

| Item | Note |
|------|------|
| Stale echarts tests mocking aggregatedBudget | cleanup when touched |
| `docs/references/*` still mention `project_pl_calc` | cleanup when touched |

## Done (cleanup)

| Item | Note |
|------|------|
| Rename `load_budget_data` → `refresh_project_pl` | ✅ 2026-07-16 |
| README / legacy-cutover / index sync | ✅ 2026-07-16 |
| Styles → `project_budget.css`; drop `project_pl_style.js` / `pl-v2.css` | ✅ 2026-07-16 |
| Next: rename JS `project_pl` / `v2` → `project_budget` (+ optional `*_tab`) | pending |

## Dropped

| Item | Note |
|------|------|
| `hide_empty` on v2 | product: не нужен (2026-07-16) |
