# CONTROLLED_LIVE Rehearsal Log

## Date
<!-- Fill in the date you run this rehearsal -->

## Environment
- Branch: `rehearsal/binance-controlled-live-min-notional`
- Commit: <!-- git log --oneline -1 -->
- REAL_TRANSFER_ENABLED before: `0`
- REAL_ORDER_ENABLED before: `0`
- V121_MODE: `SHADOW` (will change to MAINNET_TINY during rehearsal)

## Smoke (before)
- Binance: ✅ pass
- OKX: ✅ pass
- HTX: ✅ pass
- Blockers: 0
- Warnings: 0

---

## Step 1 — Env confirmation

- [ ] `V121_ENABLE_REAL_INTERNAL_TRANSFER=0` confirmed
- [ ] `V121_ENABLE_REAL_ORDER_EXECUTION=0` confirmed
- [ ] `npm run v121:verify` passed
- [ ] `npm run v121:smoke` passed (BLOCKERS=0, REAL_TRANSFER_ENABLED=false, REAL_ORDER_ENABLED=false)

---

## Step 2 — Start application

- [ ] `npm run dev` started
- [ ] `/v121/settings` loads
- [ ] `/v121/mainnet-tiny` loads

---

## Step 3 — Settings adjustment

- [ ] `useDynamicUniverse = true`
- [ ] `maxDynamicSymbolsPerExchange = 20`
- [ ] `allowAutoTransfer = true`
- [ ] `transfer.mode = auto_transfer`
- [ ] `maxAutoTransferUsdt = 2` (or exchange minimum)
- [ ] `allowRealOrders = false` (keep false initially)
- [ ] `requireHumanApproval = true`

Note: Do NOT lower `minFundingRate8h`. If no opportunity exists, proceed with dry-run only.

---

## Step 4 — Dry-run transfer

- [ ] Generate `safeExecution` → transferPlan visible
- [ ] Click "Dry-run 内部划转并重新审计"
- [ ] Status = `dry_run` or `reaudit_passed`
- [ ] Ledger record written
- [ ] No real fund movement
- [ ] No order placed

**Dry-run transfer ledger id:** <!-- fill in -->

**Status:** <!-- dry_run / reaudit_passed -->

---

## Step 5 — Real internal transfer (optional, only if you decide to proceed)

Only proceed if dry-run passed and you accept the risk.

- [ ] Edit `.env.local`: `V121_ENABLE_REAL_INTERNAL_TRANSFER=1`
- [ ] Restart `npm run dev`
- [ ] Click "执行真实内部划转并重新审计"
- [ ] Input confirmation phrase: `EXECUTE_REAL_INTERNAL_TRANSFER`
- [ ] Ledger status: `submitted` → `balance_confirmed` → `reaudit_passed`
- [ ] NO order placed
- [ ] Manually verify Binance balance changed

**Real transfer ledger id:** <!-- fill in -->
**Amount:** <!-- USDT -->
**Direction:** <!-- spot→perp / perp→spot -->
**Final status:** <!-- submitted / balance_confirmed / reaudit_passed / failed / frozen -->
**Binance page balance confirmed:** <!-- yes / no -->

**IF frozen/failed/unknown → STOP. Do not continue to order placement.**

---

## Step 6 — Generate order plan

- [ ] Click "生成下单计划"
- [ ] `orderPlan.status = validated`
- [ ] `exchange = binance`
- [ ] `spotLeg = BUY`
- [ ] `perpLeg = SELL / SHORT`
- [ ] Client order IDs differ between legs
- [ ] Leg notional deviation within threshold
- [ ] No open order conflicts

**Order plan id:** <!-- fill in -->
**Symbol:** <!-- e.g. BTC/USDT -->
**Planned notional:** <!-- USDT -->
**Spot qty:** <!-- -->
**Perp qty:** <!-- -->
**Leg deviation:** <!-- % -->
**Status:** <!-- validated / blocked -->

**IF blocked → STOP. Fix blockers before proceeding.**

---

## Step 7 — Dry-run order execution

Keep `V121_ENABLE_REAL_ORDER_EXECUTION=0`.

- [ ] Click "Dry-run 执行双腿下单"
- [ ] Status = `dry_run`
- [ ] No real order placed
- [ ] Execution ledger record created
- [ ] Spot/perp legs in result
- [ ] No frozen, no failed

**Dry-run execution id:** <!-- fill in -->
**Status:** <!-- dry_run -->

**IF dry-run fails → STOP. Fix before real order.**

---

## Step 8 — Enable real order gate

Only if dry-run passed and you accept risk.

- [ ] Edit `.env.local`: `V121_ENABLE_REAL_INTERNAL_TRANSFER=1`
- [ ] Edit `.env.local`: `V121_ENABLE_REAL_ORDER_EXECUTION=1`
- [ ] Settings page: `allowRealOrders = true`
- [ ] Settings page: `requireHumanApproval = true`
- [ ] Restart `npm run dev`

**Then re-run preflight:**
- [ ] `npm run v121:smoke` passes
- [ ] Regenerate `safeExecution`
- [ ] Re-run `final audit` — no blockers
- [ ] Regenerate `orderPlan` — validated
- [ ] Re-run dry-run order — passes

---

## Step 9 — Real two-leg order

Only Binance, minimum notional, one shot, whitelist coin, funding still meets threshold.

- [ ] Click "真实执行双腿下单"
- [ ] Input confirmation phrase: `EXECUTE_REAL_TWO_LEG_ORDER`
- [ ] Spot leg submitted
- [ ] Perp leg submitted
- [ ] Check `order_execution_ledger`

**Real execution id:** <!-- fill in -->
**Spot exchange order id:** <!-- -->
**Perp exchange order id:** <!-- -->
**Final status:** <!-- both_submitted / filled / partial / unknown / frozen / failed -->
**Frozen reason:** <!-- if any -->

**Post-execution checks:**
- [ ] Binance spot balance verified
- [ ] Binance perpetual position verified
- [ ] If `frozen` / `partial` / `unknown` / `failed` → STOP, do not retry

---

## Step 10 — Close gates immediately after rehearsal

- [ ] `.env.local`: `V121_ENABLE_REAL_INTERNAL_TRANSFER=0`
- [ ] `.env.local`: `V121_ENABLE_REAL_ORDER_EXECUTION=0`
- [ ] Settings page: `allowRealOrders = false`
- [ ] Restart `npm run dev`
- [ ] `npm run v121:verify` passes
- [ ] `npm run v121:smoke` passes

**Final gate state:**
- REAL_TRANSFER_ENABLED after: `0`
- REAL_ORDER_ENABLED after: `0`
- allowRealOrders after: `false`

---

## Notes

<!-- Any observations, issues, or follow-up items -->
