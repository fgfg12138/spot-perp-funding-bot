# V121 Unified Product Acceptance

## 1. 成品页面验收（app/(app)/**，普通用户可见）

| Page | Status | Notes |
|------|--------|-------|
| / → /dashboard | ⬜ | Root redirect works |
| /dashboard | ⬜ | 总览 loads；显示后台监控/系统健康/机会/持仓/风险保护/暂停保护；无工程词 |
| /opportunities | ⬜ | 机会列表；三态 可开仓/观察中/不符合条件；无 rehearsal/dataSource/scanMode |
| /trade/open | ⬜ | 6 步开仓向导；确认串 CONFIRM_OPEN_POSITION → 后端 EXECUTE_REAL_TWO_LEG_ORDER；真实开仓按钮在执行前校验通过前禁用 |
| /positions | ⬜ | 持仓列表；空状态引导 /trade/open 与 /trade/close |
| /trade/close | ⬜ | 持仓 + "生成平仓预案"按钮；预案含免责声明"平仓预案，未执行真实下单"；无"确认平仓"按钮 |
| /risk | ⬜ | 风险保护开关 + 暂停保护；无 Kill Switch / frozen 英文词 |
| /settings | ⬜ | 参数；无"系统模式"5 档徽章块 |
| /review | ⬜ | 复盘；7 表用产品标签；persistence → "存储状态：正常/未初始化" |

## 2. 开发者页面验收（app/v121/**，V121_ENABLE_DEV_TOOLS=1 才可访问）

| Page | Status | Notes |
|------|--------|-------|
| /v121/intents | ⬜ | 仅 dev 模式可见 |
| /v121/shadow | ⬜ | 仅 dev 模式可见 |
| /v121/mainnet-tiny | ⬜ | 仅 dev 模式可见 |
| /v121/mainnet-tiny/final-audit | ⬜ | 仅 dev 模式可见 |

门控验证：`V121_ENABLE_DEV_TOOLS` 未设为 `1` 时，`/v121/*` 返回 404，
成品导航不显示开发者入口。

## 3. 旧 URL 重定向（next.config.ts，permanent: false）

| Old URL | New URL | Status |
|---------|---------|--------|
| /v121/dashboard | /dashboard | ⬜ |
| /v121/opportunities | /opportunities | ⬜ |
| /v121/execution | /trade/open | ⬜ |
| /v121/positions | /positions | ⬜ |
| /v121/risk-center | /risk | ⬜ |
| /v121/settings | /settings | ⬜ |
| /v121/review | /review | ⬜ |

## 4. Old Page Removal

| Old Page | Status |
|----------|--------|
| /dashboard (V1.0) | ✅ git rm |
| /opportunities (V1.0) | ✅ git rm |
| /execution (V1.0) | ✅ git rm |
| /alpha | ✅ git rm |
| /basis | ✅ git rm |
| /safety | ✅ git rm |
| /audit | ✅ git rm |
| /strategy | ✅ git rm |
| /research | ✅ git rm |
| /funding | ✅ git rm |
| /heatmap | ✅ git rm |
| /factors | ✅ git rm |

## 5. /trade/open 按钮状态验收

| 按钮 | 禁用条件 | Status |
|--------|---------------|--------|
| 生成开仓方案（Step ③） | 未选择可执行机会 | ⬜ |
| 交易所参数校验（Step ④） | 开仓方案未 validated | ⬜ |
| 执行前校验（Step ⑤） | 交易所参数校验未通过 | ⬜ |
| 确认开仓（Step ⑥） | 执行前校验未通过（dry_run） | ⬜ |

## 6. Opportunity → Intent → OrderPlan → Execution Chain

| Step | Gate | Status |
|------|------|--------|
| Opportunity | funding >= minFundingRate8h, volume OK | ⬜ |
| Intent | real_arbitrage + simulationOnly=false + realTradeEligible=true | ⬜ |
| OrderPlan | validated (step rounding, deviation, minNotional) | ⬜ |
| Spot test | Only validated plans | ⬜ |
| Dry-run exec | Only validated plans | ⬜ |
| Real exec | env gate + explicitConfirm (EXECUTE_REAL_TWO_LEG_ORDER) | ⬜ |

## 7. API Smoke

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
| /api/v121/positions/[id]/close-preview | ⬜ |

## 8. 术语 lint 验收

| 检查 | Status |
|------|--------|
| `npm run lint:i18n` 通过 | ⬜ |
| 成品页 app/(app)/** 无 dry-run / OrderPlan / Intent / Ledger / Preflight / Spot test / MAINNET_TINY / SHADOW / PAPER | ⬜ |
| 成品页无旧版英文交易词 Short / Long / CrossExchange / SpotPerp | ⬜ |
| 后端 / 开发者页 / lib / components 豁免（工程词保留） | ⬜ |

## 9. Current Blockers

<!-- Fill in any blockers preventing next phase -->

## 10. Next Phase Readiness

- [ ] All product pages green
- [ ] Dev pages gated by V121_ENABLE_DEV_TOOLS=1
- [ ] All /trade/open buttons correctly disabled
- [ ] No old page remnants
- [ ] No rehearsal/simulation in execution chain
- [ ] No engineering terms in product UI (lint:i18n passes)
- [ ] All APIs respond
- [ ] Build passes
- [ ] Tests pass (vitest lib/strategy-v121)

**Ready for next phase:** ⬜ Yes / ⬜ No
