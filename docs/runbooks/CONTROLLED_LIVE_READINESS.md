# CONTROLLED_LIVE Readiness Runbook

## Scope

This runbook prepares the system for controlled live testing. It does **not** authorize unattended trading.

## Required Green Checks

Before any controlled live activity, all of the following must pass:

- [ ] `npm ci` — clean install
- [ ] `npx tsc --noEmit -p tsconfig.ci.json` — zero type errors
- [ ] `npm run lint:i18n` — i18n lint passed
- [ ] `npx vitest run lib/strategy-v121` — all 329+ tests passing
- [ ] `npm run build` — production build succeeds
- [ ] `npm audit` — reviewed, no unresolved high/critical CVEs (current: all dev-deps, accepted)
- [ ] `npm run v121:smoke` — real market data from at least 2 exchanges confirmed
- [ ] `npm run v121:worker:dry` — PAPER worker dry-run starts cleanly

## Required Default Env Gates

These must be explicitly set in `.env.local` before any real fund-moving action:

```
V121_ENABLE_REAL_INTERNAL_TRANSFER=0
V121_ENABLE_REAL_ORDER_EXECUTION=0
```

Only change to `1` when intentionally proceeding with a real action, and revert to `0` immediately after.

## Before First Live Transfer

- [ ] Binance API key must have transfer permission enabled ("Permits Universal Transfer").
- [ ] Start with minimum supported amount (1 USDT or exchange minimum).
- [ ] Run dry-run transfer first.
- [ ] Confirm ledger record written.
- [ ] Confirm Binance UI balance manually matches.

## Before First Live Order

- [ ] Generate validated order plan via `/api/v121/executions/paper`.
- [ ] Run pre-order execution gate (auto-checked by `safeExecutionOrchestrator`).
- [ ] Run dry-run two-leg order first.
- [ ] Confirm no open order conflict on exchange.
- [ ] Confirm `finalPreExecutionAudit` returns zero blockers.
- [ ] First real order must use minimum supported notional only.
- [ ] Manual confirmation required (`requireManualConfirm: true`).

## Forbidden

- ❌ No unattended trading.
- ❌ No automatic repair of short-leg (must be manual in controlled live).
- ❌ No automatic close without operator review.
- ❌ No cross-exchange internal transfer.
- ❌ No OKX live order until separately implemented and tested.
- ❌ No HTX live execution.
