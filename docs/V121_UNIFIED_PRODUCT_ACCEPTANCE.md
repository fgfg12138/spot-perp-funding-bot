# V121 Unified Product Acceptance

## 1. Page Acceptance

| Page | Status | Notes |
|------|--------|-------|
| / → /v121/dashboard | ⬜ | Redirect must work |
| /v121/dashboard | ⬜ | Control panel loads |
| /v121/opportunities | ⬜ | No rehearsal candidate |
| /v121/intents | ⬜ | Filters work |
| /v121/execution | ⬜ | All 4 sections visible |
| /v121/mainnet-tiny | ⬜ | Safety gate only |
| /v121/positions | ⬜ | Loads |
| /v121/risk-center | ⬜ | Loads |
| /v121/review | ⬜ | Loads |
| /v121/shadow | ⬜ | Loads |
| /v121/settings | ⬜ | Loads |

## 2. Old Page Removal

| Old Page | Status |
|----------|--------|
| /dashboard | ✅ git rm |
| /opportunities | ✅ git rm |
| /execution | ✅ git rm |
| /alpha | ✅ git rm |
| /basis | ✅ git rm |
| /safety | ✅ git rm |
| /audit | ✅ git rm |
| /strategy | ✅ git rm |
| /research | ✅ git rm |
| /funding | ✅ git rm |
| /heatmap | ✅ git rm |
| /factors | ✅ git rm |

## 3. Button State Acceptance

| Button | Disabled When | Status |
|--------|---------------|--------|
| 生成下单计划 | No eligible real_arbitrage intent | ⬜ |
| Spot test order | orderPlan.status !== validated | ⬜ |
| Dry-run 双腿执行 | orderPlan.status !== validated | ⬜ |
| 真实执行双腿下单 | Real gate not open | ⬜ |

## 4. Opportunity → Intent → OrderPlan → Execution Chain

| Step | Gate | Status |
|------|------|--------|
| Opportunity | funding >= minFundingRate8h, volume OK | ⬜ |
| Intent | real_arbitrage + simulationOnly=false + realTradeEligible=true | ⬜ |
| OrderPlan | validated (step rounding, deviation, minNotional) | ⬜ |
| Spot test | Only validated plans | ⬜ |
| Dry-run exec | Only validated plans | ⬜ |
| Real exec | env gate + explicitConfirm | ⬜ |

## 5. API Smoke

| API | Status |
|-----|--------|
| /api/v121/health | ⬜ |
| /api/v121/worker | ⬜ |
| /api/v121/risk | ⬜ |
| /api/v121/opportunities | ⬜ |
| /api/v121/mainnet-tiny/preflight | ⬜ |
| /api/v121/mainnet-tiny/intents | ⬜ |
| /api/v121/mainnet-tiny/order-plan | ⬜ |
| /api/v121/mainnet-tiny/order-execution | ⬜ |
| /api/v121/settings | ⬜ |
| /api/v121/shadow | ⬜ |
| /api/v121/review | ⬜ |
| /api/v121/positions | ⬜ |

## 6. Current Blockers

<!-- Fill in any blockers preventing next phase -->

## 7. Next Phase Readiness

- [ ] All pages green
- [ ] All buttons correctly disabled
- [ ] No old page remnants
- [ ] No rehearsal/simulation in execution chain
- [ ] All APIs respond
- [ ] Build passes
- [ ] Tests pass

**Ready for next phase:** ⬜ Yes / ⬜ No
