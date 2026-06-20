# V121 Software Map

## Architecture Overview

```
User Browser → /v121/* pages → /api/v121/* routes → lib/strategy-v121/ modules → Exchange APIs / SQLite
```

## Page → API → Module Mapping

| Page | API | Module |
|---|---|---|
| /v121/dashboard | /api/v121/health, /api/v121/risk, worker state | health, risk, worker |
| /v121/opportunities | /api/v121/opportunities, /api/v121/opportunity-alerts | opportunity/scanner, market/marketRefreshService |
| /v121/intents | /api/v121/mainnet-tiny/intents | execution/orderIntent |
| /v121/execution | /api/v121/mainnet-tiny/order-plan, order-execution | execution/preOrderExecutionGate, guardedOrderExecutor |
| /v121/mainnet-tiny | /api/v121/mainnet-tiny/gate, preflight, final-audit | mainnetTiny/gate, preflight, finalPreExecutionAudit |
| /v121/positions | /api/v121/positions | account/adapters |
| /v121/risk-center | /api/v121/risk, kill-switch | risk/killSwitch |
| /v121/review | /api/v121/review | persistence (7 core tables) |
| /v121/shadow | /api/v121/shadow | account/shadowAccountService |
| /v121/settings | /api/v121/settings | settings/userStrategySettingsStore |

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
