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
| Rename `load_budget_data` → `refresh_project_pl` | cosmetic |
| `hide_empty` on v2 | product |
| Stale echarts tests mocking aggregatedBudget | cleanup when touched |
