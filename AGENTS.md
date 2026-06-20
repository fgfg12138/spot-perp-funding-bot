# AGENTS.md

## Purpose of This File

This file is the working guidance for AI/code agents operating inside this repository.

The user may describe needs in non-technical or non-product language. Translate the user's intent into professional product/project/engineering terms before making changes.

Do not drift from this plan. If a new request conflicts with the roadmap or safety rules below, pause and explain the conflict before changing code.

---

## Project Identity

### Product Name

V1.2.1 Positive Funding Spot-Perpetual Arbitrage System

### Strategy Mission

Build a controlled positive funding rate spot-perpetual arbitrage system.

The target strategy is:

- Buy USDT spot.
- Short equal-notional USDT-margined perpetual.
- Only trade positive funding opportunities.
- Supported exchanges: Binance, OKX, HTX.
- Internal system time: UTC.
- Human-facing reports: UTC+8.
- Risk management has priority over profit.

This is not:

- A generic funding dashboard.
- A cross-exchange perpetual spread strategy.
- A negative funding arbitrage system.
- A high-frequency trading bot.
- A market-making system.
- A system that can jump directly into uncontrolled live trading.

---

## Current Project Baseline

Current project status:

- V1.2.1 Safe Funding Arbitrage System is no longer an early prototype.
- M0–M9 milestones are substantially complete and verified by CI (41 test files, 329 tests, all passing).
- The system includes real market scanning, dynamic universe discovery, user strategy settings, paper/shadow/mainnet-tiny safety gates, Binance guarded internal transfer, pre-order execution gate, and guarded two-leg order execution scaffolding.
- SHADOW mode reads real mainnet account state without modifying it.
- MAINNET_TINY mode is implemented with strict gates (manual confirmation, tiny notional limits, HTX/small-caps/cross-exchange disabled by default).
- Controlled live trading is not yet enabled by default.
- Real fund-moving actions remain gated by environment variables, user settings, explicit confirmation phrases, audit checks, and ledger records.

Completion estimate:

- Read-only / paper / shadow / mainnet-tiny safety system: ~90% complete.
- Overall controlled-live readiness: ~80%–85% complete.
- Fully autonomous live trading is intentionally out of scope.

Current next milestone:

M10 CONTROLLED_LIVE Readiness Gate — preparing the system for controlled real-fund validation without enabling unattended trading.

### Current missing or incomplete areas (being addressed in M10)

- Full green CI must be confirmed — ✅ done (41 test files, 329 tests all passing).
- TESTNET route removed — ✅ done, replaced with MAINNET_TINY.
- Binance internal transfer real implementation — ⚠️ adapter exists but needs real endpoint integration.
- OKX / HTX order execution not yet supported.
- Worker needs to cycle with real data for extended periods.
- Real order execution flow (guarded) exists but is dry-run only by default.
- HTX swap ticker still fails in smoke test — observe-only, non-blocking for Binance readiness.

## HTX Policy

HTX is observe-only for V1.2.1 controlled live readiness. HTX public smoke failures must be surfaced as warnings unless the current task explicitly targets HTX support. HTX must not be considered eligible for MAINNET_TINY or CONTROLLED_LIVE execution.

---

## Source of Truth

Use these documents as source references when making project decisions:

1. `strategy_rules_v121.md`
   - Strategy rules, risk rules, pricing rules, execution rules, review fields.
2. `project_rebuild_plan.md`
   - Original rebuild plan, but update it according to the current no-testnet route.
3. `AGENTS.md`
   - This current file, which overrides older workflow assumptions when conflicts exist.

If older documents mention:

```text
READ_ONLY -> PAPER -> SHADOW -> TESTNET -> LIVE
```

replace the implementation roadmap with:

```text
READ_ONLY -> PAPER -> SHADOW -> MAINNET_TINY -> CONTROLLED_LIVE -> WHITELIST_AUTO
```

There is no reliable testnet phase for this project. Do not keep Testnet as a required delivery stage.

---

## Product Roadmap

The project must be delivered in controlled milestones.

### M0 — Engineering Baseline and CI

Goal: make the repository verifiable and safe to continue.

Required work:

- Confirm GitHub Actions latest run is green.
- Keep CI scoped to V1.2.1 baseline until legacy modules are cleaned.
- Use `tsconfig.ci.json` for production-code type checking.
- Run V1.2.1 tests only during the first baseline.
- Fix i18n hardcoded English UI text if it blocks CI.
- Do not let legacy tests block current V1.2.1 work.

Required commands:

```bash
npm ci
npx tsc --noEmit -p tsconfig.ci.json
npm run lint:i18n
npx vitest run lib/strategy-v121
```

Exit criteria:

- `CI / Test and build` is green.
- V1.2.1 baseline tests pass.
- No unsafe live-trading path is enabled by default.

---

### M1 — Mode Route Correction and Mainline Isolation

Goal: align code with the actual delivery route.

Replace the old mode model:

```ts
"READ_ONLY" | "PAPER" | "SHADOW" | "TESTNET" | "LIVE"
```

with the current product model:

```ts
"READ_ONLY" | "PAPER" | "SHADOW" | "MAINNET_TINY" | "CONTROLLED_LIVE"
```

If `TESTNET` still exists, treat it as legacy compatibility only. It must not be part of the main product route.

Required work:

- Update domain types.
- Update config.
- Update `.env.example`.
- Update UI wording.
- Update docs.
- Add safety tests for every mode.
- Ensure `MAINNET_TINY` and `CONTROLLED_LIVE` are disabled by default.
- Ensure `lib/strategy-v121` is the mainline implementation.
- Keep old modules available only as legacy/reference unless explicitly instructed.

Exit criteria:

- No mainline page, API, or document presents Testnet as a required stage.
- Real-order capability is locked behind explicit environment gates.
- `READ_ONLY`, `PAPER`, and `SHADOW` cannot place real orders.
- `MAINNET_TINY` cannot place orders without explicit risk acknowledgement.
- `CONTROLLED_LIVE` cannot place orders without separate explicit live acknowledgement.

---

### M2 — Public Market Data and Unified Market Snapshot

Goal: build reliable public market data for Binance / OKX / HTX.

Required modules:

```text
lib/strategy-v121/market/
lib/strategy-v121/exchanges/
lib/strategy-v121/health/
```

Required data:

- Spot bid1 / ask1 / order book.
- Perpetual bid1 / ask1 / order book.
- Mark price.
- Index price.
- Last price for display only.
- Funding rate.
- Funding interval.
- Next funding time.
- 24h spot volume in USDT.
- 24h perpetual volume in USDT.
- Contract multiplier.
- Trading status.
- Data freshness.
- Latency.

Rules:

- Never use Last Price for core strategy decisions.
- Use executable bid/ask prices for entry and exit basis.
- Use Mark Price for perpetual risk.
- Use spot bid or sell VWAP for combo loss estimation.
- Stale data cannot be used for entry, normal exit, or automatic stop loss.

Exit criteria:

- Binance / OKX / HTX produce normalized market snapshots.
- Snapshot freshness is checked.
- Missing Mark Price blocks risk-sensitive decisions.
- Wide spread blocks new entry.

---

### M3 — Opportunity Scanner and Profitability Engine

Goal: turn market snapshots into explainable candidate opportunities.

Required modules:

```text
lib/strategy-v121/opportunity/
lib/strategy-v121/profitability/
```

Hard filters:

- Exchange must be Binance / OKX / HTX.
- Markets must be USDT spot and USDT-margined perpetual.
- Direction must be buy spot + short perpetual.
- `funding_8h >= 0.05%`.
- Spot 24h volume must be at least 1M USDT.
- Perpetual 24h volume must be at least 5M USDT.
- Contract multiplier must be known.
- Spot 0.3% ask-side depth must be at least planned position × 3.
- Perp 0.3% bid-side depth must be at least planned position × 5.
- Spot wide spread blocks new entry.
- Reduce-only contracts block new entry.
- Delisting/risk announcements block new entry.
- Cooldown blocks new entry.
- Unhealthy system state blocks new entry.

Scoring must produce:

- S / A / B / C level.
- Score breakdown.
- Pass/fail result.
- Reject reasons.
- Risk tags.
- Expected net rate.
- Expected net profit in USDT.

Profitability formula:

```text
expected_net_rate =
entry_basis
- expected_exit_basis
+ expected_funding
- fees
- slippage
- risk_discount
```

Exit criteria:

- `/api/v121/opportunities` no longer returns empty placeholder data.
- Every opportunity explains why it passed or failed.
- HTX, small-cap, and cross-exchange paths receive extra risk discounts.
- Extreme funding is treated as risk, not automatically as a good signal.

---

### M4 — Paper Execution Lifecycle

Goal: complete paper trading without real orders.

Required modules:

```text
lib/strategy-v121/execution/
lib/strategy-v121/position/
```

Paper execution must support:

- Pre-entry second validation.
- 30% / 30% / 40% batches.
- Cumulative target position recalculation.
- Protected IOC / limit-taker simulation.
- Partial fills.
- Timeout handling.
- Position deviation checks.
- Short-leg repair.
- Freeze state when order status is unknown.
- Entry execution records.
- Position creation.
- Exit execution.
- Final review.

Batch rules:

- Batch 1: 30%.
- Batch 2: 30%.
- Batch 3: 40%.
- Next batch max size = current cumulative target - already hedged position.
- Never exceed original planned position.
- If previous batch deviation is greater than 1%, repair first.
- If hedged position is zero for a batch, re-fetch market/funding/basis/profitability before retrying.

Short-leg repair rules:

- Spot filled, perp not shorted: short perp if still safe; otherwise sell spot and exit.
- Perp shorted, spot not filled: buy spot if still safe; otherwise close perp short.
- Both partially filled with deviation > 1%: cancel remainder and repair.
- Unknown order status: level-2 freeze.

Exit criteria:

- Paper API calls the execution engine, not just echo input.
- Normal 3-batch entry works.
- Partial-fill scenarios are handled.
- Short-leg scenarios are handled.
- Unknown order state enters freeze.
- Position and review records are created.

---

### M5 — Risk Engine, Freeze State, and Review Persistence

Goal: make risk controls enforceable, not just visible.

Required modules:

```text
lib/strategy-v121/risk/
lib/strategy-v121/persistence/
lib/strategy-v121/review/
```

Risk priority:

```text
hard stop loss / margin risk / short-leg repair
>
normal take profit
>
wait for funding settlement
>
new entries
```

Required risk controls:

- Position deviation.
- Hard stop loss.
- Account drawdown.
- Funding extremity.
- ADL risk.
- Liquidity deterioration.
- Basis expansion.
- Time stop.
- Cooldown.
- Level-1 freeze.
- Level-2 freeze.
- Global kill switch.

Seven core review tables:

```text
opportunity_records
entry_decisions
entry_executions
position_snapshots
funding_settlements
exit_executions
final_reviews
```

Exit criteria:

- All lifecycle events are stored.
- Expected vs actual profit can be recalculated.
- Funding realization rate can be computed.
- Basis realization rate can be computed.
- Slippage share can be computed.
- Risk events are auditable.

---

### M6 — Worker / Daemon

Goal: make the system run continuously without using tests as workers.

Required modules:

```text
scripts/v121-worker.ts
lib/strategy-v121/worker/
```

Worker responsibilities:

- Health check.
- Market refresh.
- Opportunity scan.
- Paper lifecycle progression.
- Position monitoring.
- Risk check.
- Review persistence.
- Dashboard status update.
- Heartbeat.
- Safe shutdown.

Package scripts to add when ready:

```json
{
  "v121:worker": "tsx scripts/v121-worker.ts",
  "v121:worker:dry": "V121_MODE=PAPER V121_DRY_RUN=1 tsx scripts/v121-worker.ts"
}
```

Exit criteria:

- Worker starts.
- Worker stops safely.
- Dashboard can show heartbeat.
- Market failure enters freeze.
- Kill switch stops execution actions.

---

### M7 — API and UI Wiring

Goal: make pages show real V1.2.1 system state.

Required API areas:

```text
GET  /api/v121/health
GET  /api/v121/opportunities
POST /api/v121/opportunities/scan
GET  /api/v121/executions/paper
POST /api/v121/executions/paper
GET  /api/v121/positions
GET  /api/v121/risk
POST /api/v121/risk/kill-switch
GET  /api/v121/review
GET  /api/v121/settings
POST /api/v121/settings
```

Required pages:

```text
/v121/dashboard
/v121/opportunities
/v121/execution
/v121/positions
/v121/risk-center
/v121/review
/v121/settings
```

Rules:

- Mock fallback is allowed only if clearly labeled.
- Pages must not pretend mock data is live data.
- High-risk actions require confirmation.
- LIVE-related buttons must be disabled by default.

Exit criteria:

- Pages are API-driven.
- Operators can understand current mode, risk state, opportunities, executions, positions, and review results.
- Kill switch is visible and functional.

---

### M8 — SHADOW Mainnet Read-Only Mode

Goal: read real mainnet account state without modifying the account.

Allowed in SHADOW:

- Read balances.
- Read positions.
- Read open orders.
- Read fee tier.
- Read funding history.
- Generate "what would happen if executed" reports.

Forbidden in SHADOW:

- Real order placement.
- Real cancel.
- Leverage change.
- Margin mode change.
- Any account-modifying action.

Exit criteria:

- No API key means SHADOW cannot start.
- API secrets are server-side only.
- Frontend never receives secrets.
- Any order-sending function rejects immediately in SHADOW.
- System can run 3–7 days producing audit reports.

---

### M9 — MAINNET_TINY Mainnet Small-Funds Validation

Goal: replace Testnet with highly restricted mainnet tiny validation.

MAINNET_TINY is not normal live trading. It is the production substitute for unavailable testnet verification.

Required environment gates:

```env
V121_MODE=MAINNET_TINY
V121_MAINNET_TINY_ENABLED=true
V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND
V121_LIVE_ENABLED=false
```

Default limits:

```ts
export const MAINNET_TINY_DEFAULT_LIMITS = {
  maxOrderNotionalUsdt: 10,
  maxTotalExposureUsdt: 50,
  maxDailyTrades: 3,
  maxSingleSymbolEquityRatio: 0.005,
  maxTotalEquityRatio: 0.03,
  maxDailyLossEquityRatio: 0.002,
  leverage: 1,
  allowHtx: false,
  allowSmallCaps: false,
  allowCrossExchange: false,
  requireManualConfirm: true,
  allowAutoEntry: false,
  allowRiskExit: true,
};
```

Initial allowed scope:

- Binance same-exchange path.
- OKX same-exchange path.
- Major liquid coins only.
- Manual confirmation only.

Initial forbidden scope:

- HTX.
- Small caps.
- Cross-exchange.
- Newly listed tokens.
- Extreme funding.
- Automatic entry.

Exit criteria:

- Real tiny orders can be placed only after all gates pass.
- Filled order state is verified from the exchange.
- Position state is verified from the exchange.
- Short-leg handling is tested.
- Exit returns position to zero.
- Every action is written to audit/review records.
- At least 20–50 stable tiny validation trades before progressing.

---

### M10 — CONTROLLED_LIVE Mainnet Controlled Trading

Goal: controlled small-capital live trading after MAINNET_TINY succeeds.

Required environment gates:

```env
V121_MODE=CONTROLLED_LIVE
V121_LIVE_ENABLED=true
V121_CONFIRM_LIVE_RISK=I_UNDERSTAND
V121_KILL_SWITCH=OFF
```

Default limits:

```ts
export const CONTROLLED_LIVE_DEFAULT_LIMITS = {
  maxSingleSymbolEquityRatio: 0.03,
  maxTotalEquityRatio: 0.30,
  leverage: 1,
  allowHtx: false,
  allowSmallCaps: false,
  requireManualConfirm: true,
  allowAutoEntry: false,
  allowRiskExit: true,
};
```

Exit criteria:

- No confirmation means no order.
- Kill switch blocks all execution.
- Position limits are enforced.
- API secrets are never exposed to frontend.
- Every real trading action has an audit record.
- Runs stable for 2–4 weeks before any automation expansion.

---

### M11 — WHITELIST_AUTO Controlled Automation

Goal: limited automation only for proven paths.

Conditions:

- 2–4 weeks stable CONTROLLED_LIVE operation.
- No major short-leg incident.
- No freeze-handling failure.
- Profit attribution is explainable.
- Funding realization is stable.
- Slippage is within limits.
- Kill switch, freeze, hard stop, and exit rules have been exercised.

Automation scope must be whitelist-only.

---

## Strategy Rules That Must Not Be Violated

### Priority

```text
hard stop loss / margin risk / short-leg repair
>
normal take profit
>
wait for funding settlement
>
new entries
```

### Price Basis

Use:

- Entry basis = perp bid / spot ask - 1.
- Exit basis = perp ask / spot bid - 1.
- Risk basis = perp Mark Price / spot mid - 1.
- Combo loss spot valuation = spot bid or sell VWAP.
- Perp risk valuation = Mark Price.

Never use:

- Last Price for core risk or entry decisions.
- Spot ask to overvalue spot holdings in combo loss.
- Stale data for entry, normal exit, or automatic stop loss.

### Funding

- Normalize to `funding_8h`.
- `funding_8h < 0.05%` fails hard filter.
- `0.30%–0.50%` is abnormal and must not be auto-added.
- `0.50%–1.00%` blocks new entry.
- `>1.00%` defaults to blacklist.

### Liquidity

- Spot 24h volume must be at least 1M USDT.
- Perp 24h volume must be at least 5M USDT.
- Spot 0.3% ask depth must be at least planned position × 3.
- Perp 0.3% bid depth must be at least planned position × 5.
- Wide spot spread blocks new entry.

### Execution

- Use protected limit-taker / IOC style behavior.
- Do not use unprotected market orders.
- One batch should complete within 10 seconds or enter partial-fill handling.
- Unknown order status means level-2 freeze.

### Holding and Exit

- Monitor ordinary positions every 1–5 minutes.
- Monitor near funding every 10–30 seconds.
- Exit when exit basis is favorable, profit target is reached, funding turns weak/negative, time stop triggers, or risk requires exit.
- Closing means sell spot and buy back perpetual short.

### Freeze

Level-1 freeze allows:

- Cancel known orders.
- Query real positions.
- Confirm market via REST.
- Handle hard stop, margin risk, and short-leg repair if data is reliable.

Level-1 freeze forbids:

- New entries.
- Additions.
- Normal take profit based on stale data.

Level-2 freeze allows:

- Cancel known orders.
- Stop entries.
- Alert operator.
- Wait for recovery.

Level-2 freeze forbids:

- New entries.
- Additions.
- Normal automatic exits from stale data.
- Automatic hard stop from stale price.

---

## Existing Code Policy

### Preserve

- Next.js app structure.
- React UI foundation.
- TypeScript configuration.
- Tailwind styling.
- Vitest test setup.
- Useful read-only Binance / OKX / HTX connector patterns.
- Audit / safety / kill switch concepts where compatible.

### Mainline

New and continuing implementation should live under:

```text
lib/strategy-v121/
app/v121/
app/api/v121/
```

Preferred structure:

```text
lib/strategy-v121/
  api/
  config/
  domain/
  time/
  market/
  exchanges/
  health/
  opportunity/
  profitability/
  execution/
  position/
  risk/
  persistence/
  review/
  worker/
```

### Legacy / Avoid Expanding

Avoid expanding these unless explicitly instructed:

```text
lib/arbitrage/
lib/liveAuto/
lib/fundingSpread/
lib/fundingSpreadPaperTrader/
lib/crossExchangeExecution/
lib/connectors/mocks/
app/alpha/
app/research/
app/heatmap/
app/factors/
```

Do not let legacy modules determine V1.2.1 product behavior.

---

## API Key and Real Trading Safety

API key rules:

- API keys must be read only from server-side environment variables.
- Never store API secrets in localStorage.
- Never send API secrets to frontend.
- Prefer keys with withdrawal disabled.
- Every real account action must write an audit record.
- Every real order must be gated by mode, environment flags, risk checks, manual confirmation, and kill switch.

Real-order paths must reject unless the mode explicitly allows them.

READ_ONLY:

- No account reads required.
- No orders.

PAPER:

- No real account modification.
- No real orders.

SHADOW:

- Read real account state.
- No real orders.
- No real cancels.

MAINNET_TINY:

- Real tiny orders allowed only with explicit gates and manual confirmation.
- Default max order is 10 USDT.
- Default max total exposure is 50 USDT.
- HTX, small caps, and cross-exchange are disabled by default.

CONTROLLED_LIVE:

- Real orders allowed only with explicit live gates.
- Default manual confirmation remains required.
- Automation must not be enabled by default.

---

## Testing Requirements

Every new core module must have tests.

Required test areas:

- `funding_8h` normalization.
- Basis calculation.
- VWAP calculation.
- Hard filters.
- Scoring.
- Net profit calculation.
- Funding decay.
- Batch execution.
- Position deviation.
- Short-leg repair.
- Combo PnL.
- Freeze state.
- Stop loss.
- Cooldown.
- Mode gates.
- Mainnet tiny limits.
- Kill switch.
- API key safety.

Do not claim completion unless tests pass or the failure is clearly explained.

---

## CI Policy

Current baseline CI should run:

```bash
npm ci
npx tsc --noEmit -p tsconfig.ci.json
npm run lint:i18n
npx vitest run lib/strategy-v121
```

Do not add full `npm test` or `npm run build` back into mandatory CI until the V1.2.1 mainline is stable and legacy modules are cleaned or isolated.

Future CI hardening order:

1. V1.2.1 baseline tests.
2. API route tests.
3. Production build.
4. Page smoke tests.
5. Coverage.
6. Legacy cleanup.
7. Security scanning.

---

## Implementation Workflow

Each task must be small and reviewable.

For every implementation task:

1. Identify the current milestone.
2. Inspect relevant files.
3. State the intended change briefly.
4. Make the smallest safe change.
5. Add or update tests.
6. Run relevant tests.
7. Report:
   - Changed files.
   - Tests run.
   - Test result.
   - Remaining risks.
   - Whether the project may move to the next milestone.

Do not rewrite the whole project in one task.

---

## Reporting Format for AI Agents

Use this format after each completed task:

```markdown
## Progress Report

### Current Milestone
M0 / M1 / M2 / ...

### Completed
- ...

### Changed Files
- ...

### Tests Run
```bash
...
```

### Result
Passed / Failed

### Remaining Risks
- ...

### Next Recommended Task
- ...
```

If a test fails, include the exact failing command and a concise reason.

---

## Hard Prohibitions

Do not:

- Implement negative funding arbitrage.
- Add Bybit, Bitget, Gate, or Hyperliquid to the V1.2.1 mainline.
- Use coin-margined contracts.
- Use delivery futures.
- Depend on automatic cross-exchange transfers.
- Use unprotected market orders.
- Use Last Price for core strategy decisions.
- Use stale data for entry, normal exit, or automatic stop loss.
- Let unknown order status continue to the next batch.
- Enable real trading by default.
- Treat MAINNET_TINY as normal live trading.
- Skip READ_ONLY, PAPER, or SHADOW before mainnet tiny validation.
- Store API secrets in frontend storage.
- Bypass kill switch for convenience.
- Expand legacy modules unless required for migration.
- Claim completion without passing tests or explaining failures.

---

## Current Immediate Priority

The next work should start with:

1. Confirm CI baseline is green.
2. Replace Testnet route with `MAINNET_TINY` and `CONTROLLED_LIVE`.
3. Add mode-gate tests.
4. Update `.env.example` and docs.
5. Then move to real market snapshots and opportunity scanning.

Do not start live-order work before these are complete.
