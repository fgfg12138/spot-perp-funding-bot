# V121 Software Map

## Architecture Overview

```
User Browser
  ├── 成品页面 app/(app)/**  → /api/v121/* routes → lib/strategy-v121/ → Exchange APIs / SQLite
  └── 开发者页面 app/v121/**   (仅 V121_ENABLE_DEV_TOOLS=1 可访问，否则 404)
```

- 成品页面位于路由组 `app/(app)/`，URL 不带 `(app)`（路由组不影响 URL）。
- 开发者页面位于 `app/v121/`，由 `app/v121/layout.tsx` 的 `notFound()` 守卫门控：
  构建期 `process.env.V121_ENABLE_DEV_TOOLS !== "1"` 时全部 404。
- `next.config.ts` 的 `redirects()`（`permanent: false`）把旧 `/v121/<产品页>` URL
  重定向到新成品路径，避免书签失效。

## Page → API → Module Mapping

### 成品页面（app/(app)/**，普通用户可见）

| Page | API | Module |
|---|---|---|
| /dashboard | /api/v121/health, /api/v121/worker, /api/v121/risk, /api/v121/opportunities, /api/v121/positions | health, worker, risk, opportunity/scanner |
| /opportunities | /api/v121/opportunities, /api/v121/opportunities/scan | opportunity/scanner, market/marketRefreshService |
| /trade/open | /api/v121/mainnet-tiny/intents, order-plan, order-plan/test, order-execution | execution/orderIntent, preOrderExecutionGate, guardedOrderExecutor |
| /positions | /api/v121/positions | execution/paperStore |
| /trade/close | /api/v121/positions, /api/v121/positions/[id]/close-preview | execution/paperStore, market/binancePublicAdapter, position/exitRules |
| /risk | /api/v121/risk | risk/killSwitch |
| /settings | /api/v121/settings | settings/userStrategySettingsStore |
| /review | /api/v121/review | persistence (7 core tables) |

### 开发者页面（app/v121/**，V121_ENABLE_DEV_TOOLS=1 才可访问）

| Page | API | Module |
|---|---|---|
| /v121/intents | /api/v121/mainnet-tiny/intents | execution/orderIntent |
| /v121/shadow | /api/v121/shadow | account/shadowAccountService |
| /v121/mainnet-tiny | /api/v121/mainnet-tiny/gate, preflight, final-audit | mainnetTiny/gate, preflight, finalPreExecutionAudit |
| /v121/mainnet-tiny/final-audit | /api/v121/mainnet-tiny/final-audit | finalPreExecutionAudit |

## Data Flow for Order Execution

```
Market Data → Scanner → Opportunity Records
    ↓
Order Intent (real_arbitrage + simulationOnly=false + realTradeEligible=true)
    ↓
Pre-Order Gate → Order Plan (validated)
    ↓
Spot Test Order (optional validation)
    ↓
Dry-Run Two-Leg Execution
    ↓
Real Two-Leg Execution (gated by env + explicitConfirm)
    ↓
Execution Ledger / Freeze State
```

成品页 `/trade/open` 把上述流程包装成 6 步用户向导：
① 选择可执行机会 → ② 准备资金（可选）→ ③ 生成开仓方案 →
④ 交易所参数校验 → ⑤ 执行前校验 → ⑥ 确认开仓。
确认串映射：用户输入 `CONFIRM_OPEN_POSITION`，前端映射成后端 `EXECUTE_REAL_TWO_LEG_ORDER`。
后端安全机制（preflight / safeExecution / 11-gate / kill switch / freeze）完全保留不变。

## Close Preview（平仓预案，不下单）

```
/trade/close → POST /api/v121/positions/[id]/close-preview
  → paperStore.findById
  → BinancePublicAdapter.fetchOrderBook(Spot) + fetchOrderBook + fetchFundingInfo  (公共行情，无需 API key)
  → calcExitExecutableBasis(perpAsk1, spotBid1)
  → 累计 funding_settlements.received
  → shouldExitPosition (纯函数)
  → 返回预案 + "平仓预案，未执行真实下单。"
```

约束：仅币安路径；不调用任何下单接口；真实平仓属 Task P2，当前未实现。

## Key Safety Gates

1. **Mode Gate**: Must be MAINNET_TINY or CONTROLLED_LIVE for any real action
2. **Env Gate**: V121_ENABLE_REAL_INTERNAL_TRANSFER / V121_ENABLE_REAL_ORDER_EXECUTION must be "1"
3. **Intent Gate**: Only real_arbitrage + simulationOnly=false + realTradeEligible=true
4. **Plan Gate**: Only validated order plans can be tested or executed
5. **Confirm Gate**: Explicit confirmation phrase required for real actions
6. **Freeze Gate**: Frozen state blocks all real actions

## Exchange Support

| Exchange | Market Data | Account Read | Internal Transfer | Order Execution |
|---|---|---|---|---|
| Binance | ✅ | ✅ | ✅ (dry-run + real) | ✅ (dry-run + real, gated) |
| OKX | ✅ | ✅ | ❌ (not_implemented) | ❌ |
| HTX | ⚠️ (observe-only) | ⚠️ | ❌ | ❌ |

## Runtime Data

- SQLite database: `.v121-data/v121.sqlite`
- Worker heartbeat: `worker_heartbeat` table
- Opportunity cache: `latest_scan`, `opportunity_records`
- Transfer ledger: `internal_transfer_ledger`
- Order execution ledger: `order_execution_ledger`
- Order plan ledger: `order_plan_ledger`

## 产品化术语映射（工程词 → 产品词）

| 工程词（后端保留） | 产品词（成品 UI） |
|---|---|
| dry-run | 执行前校验 |
| OrderPlan | 开仓方案 |
| Intent | 可执行机会 |
| Ledger | 执行记录 |
| Preflight | 系统安全检查 |
| blocked | 暂不可执行 |
| frozen | 已暂停保护 |
| Worker | 后台监控 |
| Kill Switch | 风险保护开关 |

工程词只存在于后端代码与开发者页面；成品页面 (`app/(app)/**`) 不可出现，
由 `scripts/lint-i18n.mjs` 在 CI 中拦截。
