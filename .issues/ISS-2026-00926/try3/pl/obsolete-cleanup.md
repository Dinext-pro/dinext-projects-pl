# Obsolete cleanup — Project P&L after DinextTable cutover

> Дата: 2026-07-16  
> После: `4e75268` cutover + cleanup commit

## Done this pass

- Removed: `updateBudgetTable`, `budget_dt`, `bg_hide_empty`, `_pl_v2_enabled` gates, quarter/year period branches, dual DOM cleanup, debug `console.log`
- `load_budget_data` / `updateTaskDimension` → v2 refresh + chart (cross-app names kept)
- WE `syncPlTaskDimensionFromWe` → always refresh P&L v2 (no aggregatedBudget guard)
- pl-from-we “budget loaded” → accepts `pl_v2.rows`
- Risk: clear user message that reserve calc needs legacy cache (adapter pending)

## Still obsolete / blocked

| Item | Why blocked |
|------|-------------|
| `project_pl_calc.js` bulk delete | risk still calls `get_child_budget_sum` / cache helpers when `aggregatedBudget` exists |
| `frm.aggregatedBudget` population | risk reserve % + parent_adjustments; pl-from-we parent_adjustments |
| `get_parent_budget_limit` | risk expects it; was deleted with Sticky helpers — restore with adapter |
| `hide_empty` | no UI; product decide implement vs drop |
| Stale tests on calc/echarts aggregatedBudget | rewrite after adapter or delete with calc |

## Next (recommended)

1. **Adapter** `frm.pl_v2.rows` → `frm.aggregatedBudget` map (minimal fields risk needs)
2. Restore `get_parent_budget_limit` + `getBudgetKey*` into `project_pl_calc.js`
3. Slim calc to risk-only exports; drop `project_pl_calc.test.js` Sticky suites or rewrite
4. Rename `load_budget_data` → `refresh_project_pl` in risk/WE after adapter
