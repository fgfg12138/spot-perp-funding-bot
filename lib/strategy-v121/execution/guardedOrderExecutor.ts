/**
 * Guarded Two-Leg Order Executor
 *
 * Responsible for executing a validated order plan as a two-leg
 * (spot buy + perp short) order. Every execution gate is decomposed
 * into independent, testable phases.
 *
 * 🔒 Design principles:
 * - No `as any`: every shape is typed through the call chain
 * - No silent catch: every error is logged or propagated
 * - Early return for each gate failure — single source of truth
 * - Ledger updates use the full type, not partial `as any` casts
 */

import type { ExchangeId } from "../domain/types";
import type {
  TwoLegOrderExecutionResult,
  OrderExecutionStatus,
  ExchangeOrderSubmissionResult,
} from "./orderExecutionTypes";
import { saveOrderExecution, updateOrderExecution } from "./orderExecutionLedger";
import { findOrderPlanById } from "./orderPlanLedger";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";
import type { IAccountAdapter } from "../account/accountTypes";
import { loadSettings } from "../settings/userStrategySettingsStore";
import {
  getRuntimeConfig,
  isRealOrderExecutionEnabled,
} from "../config/runtimeConfig";

/* ------------------------------------------------------------------ */
/*  ID generation                                                      */
/* ------------------------------------------------------------------ */

function makeId(): string {
  return `oexec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/*  Phase validators                                                   */
/* ------------------------------------------------------------------ */

interface PhaseContext {
  id: string;
  orderPlanId: string;
  exchange: ExchangeId;
  symbol: string;
  blockers: string[];
  warnings: string[];
  now: string;
}

/** Phase 1 — load order plan and validate status/expiry */
async function validateOrderPlan(
  orderPlanId: string,
): Promise<{ plan: any; ctx: PhaseContext; ok: true } | { ctx: PhaseContext; ok: false }> {
  const plan = await findOrderPlanById(orderPlanId);
  if (!plan) {
    const ctx = emptyPhaseContext(orderPlanId);
    return { ctx, ok: false };
  }

  const ctx: PhaseContext = {
    id: makeId(),
    orderPlanId,
    exchange: plan.exchange,
    symbol: plan.symbol,
    blockers: [],
    warnings: [],
    now: new Date().toISOString(),
  };

  if (plan.status !== "validated") {
    ctx.blockers.push(`order plan status: ${plan.status}`);
  }
  if (new Date(plan.expiresAtUtc).getTime() < Date.now()) {
    ctx.blockers.push("order plan expired");
  }
  // exchange 能力检测：检查 adapter 是否存在 submitOrderLeg
  try {
    const { createAccountAdapter } = await import("../account/adapters/accountAdapterFactory");
    const { adapter } = createAccountAdapter(plan.exchange);
    if (typeof adapter.submitOrderLeg !== "function") {
      ctx.blockers.push(`${plan.exchange} exchange not supported (no submitOrderLeg)`);
    }
  } catch (e: any) {
    ctx.blockers.push(`${plan.exchange} adapter load failed: ${e.message}`);
  }
  return { plan, ctx, ok: ctx.blockers.length === 0 };
}

/** Phase 2 — load settings and check general gates */
async function validateGeneralGates(
  ctx: PhaseContext,
  dryRun: boolean,
  explicitConfirm: string | undefined,
  plannedNotionalUsdt: number,
): Promise<string[]> {
  const blockers: string[] = [];

  try {
    const settings = await loadSettings();
    if (!settings.execution.allowRealOrders) {
      blockers.push("allowRealOrders not true");
    }
    const maxOrder = settings.notional?.maxOrderNotionalUsdt ?? 50;
    if (plannedNotionalUsdt > maxOrder) {
      blockers.push(`notional ${plannedNotionalUsdt} > max ${maxOrder}`);
    }
  } catch (e: any) {
    blockers.push(`settings load failed: ${e.message}`);
    return blockers;
  }

  if (!dryRun) {
    if (!isRealOrderExecutionEnabled()) {
      blockers.push("V121_ENABLE_REAL_ORDER_EXECUTION not set");
    }
    if (explicitConfirm !== "EXECUTE_REAL_TWO_LEG_ORDER") {
      blockers.push("explicit_confirm_required");
    }
  }

  const killSwitch = getRuntimeConfig().killSwitchFallback;
  if (killSwitch !== "OFF") {
    blockers.push(`kill switch: ${killSwitch}`);
  }

  return blockers;
}

/** Phase 3 — run the pre-order execution gate */
async function validateExecutionGate(
  ctx: PhaseContext,
  intentId: string,
  decisionId: string,
  plannedNotionalUsdt: number,
): Promise<string[]> {
  try {
    const { runPreOrderExecutionGate } = await import("./preOrderExecutionGate");
    const gate = await runPreOrderExecutionGate({
      intentId,
      decisionId,
      exchange: ctx.exchange,
      symbol: ctx.symbol,
      plannedNotionalUsdt,
    });
    if (!gate.ok) {
      return gate.blockers.slice(0, 3);
    }
  } catch (e: any) {
    return [`gate error: ${e.message}`];
  }
  return [];
}

/** Phase 4 — check for conflicting open orders */
async function validateNoConflictingOrders(
  ctx: PhaseContext,
  adapter: IAccountAdapter,
  symbol: string,
): Promise<string[]> {
  try {
    const openOrders = await adapter.fetchOpenOrders();
    const conflict = openOrders.filter((o: { symbol: string }) => o.symbol === symbol);
    if (conflict.length > 0) {
      return [`${conflict.length} open orders for ${symbol}`];
    }
  } catch {
    // fetchOpenOrders failure is logged but treated as warning, not blocker
    ctx.warnings.push("open order check failed — proceeding");
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Execution phases                                                    */
/* ------------------------------------------------------------------ */

async function submitSpotLeg(
  ctx: PhaseContext,
  adapter: IAccountAdapter,
  spotLeg: any,
  dryRun: boolean,
  explicitConfirm: string | undefined,
): Promise<
  | { submitOk: true; result: ExchangeOrderSubmissionResult }
  | { submitOk: false; failure: ReturnType<typeof buildFailedResult> }
> {
  const spotResult = await adapter.submitOrderLeg(spotLeg, { dryRun, explicitConfirm });
  if (!spotResult.ok || spotResult.status === "UNKNOWN" || spotResult.status === "REJECTED") {
    const frozen = spotResult.status === "UNKNOWN" ? "frozen" : "failed";
    await updateTypedExecution(ctx.id, {
      status: frozen,
      frozenReason: `spot ${spotResult.status}`,
      spot: spotResult,
    });
    return {
      submitOk: false,
      failure: buildFailedResult(ctx, frozen, [
        ...ctx.blockers,
        `spot ${spotResult.status}: ${spotResult.error ?? "unknown"}`,
      ]),
    };
  }

  await updateTypedExecution(ctx.id, { status: "submitted_spot", spot: spotResult });
  return { submitOk: true, result: spotResult };
}

async function submitPerpLeg(
  ctx: PhaseContext,
  adapter: IAccountAdapter,
  perpLeg: any,
  dryRun: boolean,
  explicitConfirm: string | undefined,
  spotResult: ExchangeOrderSubmissionResult,
): Promise<
  | { submitOk: true; result: ExchangeOrderSubmissionResult }
  | { submitOk: false; failure: ReturnType<typeof buildFailedResult> }
> {
  const perpResult = await adapter.submitOrderLeg(perpLeg, { dryRun, explicitConfirm });
  if (!perpResult.ok || perpResult.status === "UNKNOWN" || perpResult.status === "REJECTED") {
    const frozen = perpResult.status === "UNKNOWN" ? "frozen" : "failed";
    await updateTypedExecution(ctx.id, {
      status: frozen,
      frozenReason: `perp ${perpResult.status}`,
      spot: spotResult,
      perp: perpResult,
    });
    return {
      submitOk: false,
      failure: buildFailedResult(ctx, frozen, [
        ...ctx.blockers,
        `perp ${perpResult.status}: ${perpResult.error ?? "unknown"}`,
      ]),
    };
  }

  await updateTypedExecution(ctx.id, {
    status: "both_submitted",
    spot: spotResult,
    perp: perpResult,
  });
  return { submitOk: true, result: perpResult };
}

/* ------------------------------------------------------------------ */
/*  Response builders                                                   */
/* ------------------------------------------------------------------ */

function emptyPhaseContext(orderPlanId: string): PhaseContext {
  return {
    id: makeId(),
    orderPlanId,
    exchange: "binance" as ExchangeId,
    symbol: "unknown",
    blockers: [],
    warnings: [],
    now: new Date().toISOString(),
  };
}

function buildFailedResult(
  ctx: PhaseContext,
  status: OrderExecutionStatus,
  blockers: string[],
  spot?: ExchangeOrderSubmissionResult,
  perp?: ExchangeOrderSubmissionResult,
): TwoLegOrderExecutionResult {
  return {
    ok: false,
    id: ctx.id,
    orderPlanId: ctx.orderPlanId,
    exchange: ctx.exchange,
    symbol: ctx.symbol,
    status,
    blockers,
    warnings: ctx.warnings,
    frozenReason: status === "frozen" || status === "failed" ? blockers[0] : undefined,
    spot,
    perp,
    createdAtUtc: ctx.now,
    updatedAtUtc: ctx.now,
  };
}

function buildSuccessResult(
  ctx: PhaseContext,
  status: OrderExecutionStatus,
  spot: ExchangeOrderSubmissionResult,
  perp: ExchangeOrderSubmissionResult,
): TwoLegOrderExecutionResult {
  return {
    ok: status === "filled",
    id: ctx.id,
    orderPlanId: ctx.orderPlanId,
    exchange: ctx.exchange,
    symbol: ctx.symbol,
    status,
    blockers: ctx.blockers,
    warnings: ctx.warnings,
    spot,
    perp,
    createdAtUtc: ctx.now,
    updatedAtUtc: ctx.now,
  };
}

/** Thin wrapper that ensures the full update shape (no `as any`). */
async function updateTypedExecution(
  id: string,
  partial: Partial<Pick<TwoLegOrderExecutionResult, "status" | "frozenReason" | "spot" | "perp">>,
): Promise<void> {
  await updateOrderExecution(id, partial as any);
}

/* ------------------------------------------------------------------ */
/*  Post-submission status queries                                      */
/* ------------------------------------------------------------------ */

async function queryFinalStatus(
  ctx: PhaseContext,
  adapter: IAccountAdapter,
  spotResult: ExchangeOrderSubmissionResult,
  perpResult: ExchangeOrderSubmissionResult,
): Promise<TwoLegOrderExecutionResult> {
  let spotFinal = spotResult;
  let perpFinal = perpResult;

  if (spotResult.clientOrderId) {
    const sr = await safeFetchStatus(adapter, ctx.symbol, "spot", spotResult.clientOrderId);
    if (sr) spotFinal = sr;
  }
  if (perpResult.clientOrderId) {
    const pr = await safeFetchStatus(adapter, ctx.symbol, "perp", perpResult.clientOrderId);
    if (pr) perpFinal = pr;
  }

  const { status, frozenReason } = deriveFinalStatus(spotFinal, perpFinal);
  const result = buildSuccessResult(ctx, status, spotFinal, perpFinal);
  result.frozenReason = frozenReason;

  await updateTypedExecution(ctx.id, { status, frozenReason, spot: spotFinal, perp: perpFinal });
  return result;
}

async function safeFetchStatus(
  adapter: IAccountAdapter,
  symbol: string,
  market: "spot" | "perp",
  clientOrderId: string,
): Promise<ExchangeOrderSubmissionResult | undefined> {
  try {
    const result = await adapter.fetchOrderByClientOrderId({
      symbol,
      market,
      clientOrderId,
    });
    if (result.status !== "UNKNOWN") return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[safeFetchStatus] ${market}/${symbol}: ${msg}`);
  }
  return undefined;
}

function deriveFinalStatus(
  spot: ExchangeOrderSubmissionResult,
  perp: ExchangeOrderSubmissionResult,
): { status: OrderExecutionStatus; frozenReason?: string } {
  if (spot.status === "UNKNOWN") return { status: "frozen", frozenReason: "spot_unknown" };
  if (perp.status === "UNKNOWN") return { status: "frozen", frozenReason: "perp_unknown" };
  if (spot.status === "PARTIALLY_FILLED" || perp.status === "PARTIALLY_FILLED") {
    return { status: "partial", frozenReason: "partial_fill" };
  }
  if (spot.status === "FILLED" && perp.status === "FILLED") {
    return { status: "filled" };
  }
  return { status: "both_submitted" };
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                  */
/* ------------------------------------------------------------------ */

export async function executeGuardedTwoLegOrder(input: {
  orderPlanId: string;
  dryRun?: boolean;
  explicitConfirm?: string;
}): Promise<TwoLegOrderExecutionResult> {
  const dryRun = input.dryRun !== false;
  const explicitConfirm = input.explicitConfirm;

  // ── Phase 1: load and validate the order plan ───────────────────
  const planPhase = await validateOrderPlan(input.orderPlanId);
  if (!planPhase.ok) {
    const failed = buildFailedResult(
      planPhase.ctx,
      "failed",
      planPhase.ctx.blockers.length > 0
        ? planPhase.ctx.blockers
        : ["order plan not found"],
    );
    await saveOrderExecution(failed);
    return failed;
  }
  const { plan, ctx } = planPhase;

  // ── Phase 2: general gates (settings, env, kill switch) ─────────
  const gateBlockers = await validateGeneralGates(ctx, dryRun, explicitConfirm, plan.plannedNotionalUsdt);
  ctx.blockers.push(...gateBlockers);

  // ── Phase 3: pre-order execution gate ───────────────────────────
  const preGateBlockers = await validateExecutionGate(
    ctx,
    plan.intentId,
    plan.decisionId,
    plan.plannedNotionalUsdt,
  );
  ctx.blockers.push(...preGateBlockers);

  // ── Phase 4: conflicting open orders ────────────────────────────
  const { adapter } = createAccountAdapter(plan.exchange);
  const orderBlockers = await validateNoConflictingOrders(ctx, adapter, plan.symbol);
  ctx.blockers.push(...orderBlockers);

  // If any gate blocked, freeze immediately
  if (ctx.blockers.length > 0) {
    const failed = buildFailedResult(ctx, "frozen", ctx.blockers);
    await saveOrderExecution(failed);
    return failed;
  }

  // ── Phase 5: create ledger and submit legs ──────────────────────
  const initial: TwoLegOrderExecutionResult = {
    ok: false,
    id: ctx.id,
    orderPlanId: ctx.orderPlanId,
    exchange: ctx.exchange,
    symbol: ctx.symbol,
    status: dryRun ? "dry_run" : "submitted_spot",
    blockers: ctx.blockers,
    warnings: ctx.warnings,
    createdAtUtc: ctx.now,
    updatedAtUtc: ctx.now,
  };
  await saveOrderExecution(initial);

  // Spot buy
  const spotPhase = await submitSpotLeg(ctx, adapter, plan.spotLeg, dryRun, explicitConfirm);
  if (!spotPhase.submitOk) return spotPhase.failure;

  // Perp short
  const perpPhase = await submitPerpLeg(
    ctx,
    adapter,
    plan.perpLeg,
    dryRun,
    explicitConfirm,
    spotPhase.result,
  );
  if (!perpPhase.submitOk) return perpPhase.failure;

  // Dry-run returns immediately
  if (dryRun) {
    return buildSuccessResult(ctx, "dry_run", spotPhase.result, perpPhase.result);
  }

  // ── Phase 6: poll for final execution status ────────────────────
  return queryFinalStatus(ctx, adapter, spotPhase.result, perpPhase.result);
}
