import type { TwoLegOrderExecutionResult, OrderExecutionStatus } from "./orderExecutionTypes";
import { saveOrderExecution, updateOrderExecution } from "./orderExecutionLedger";
import { findOrderPlanById } from "./orderPlanLedger";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";
import { getRepository } from "../persistence/repositoryFactory";

function makeId(): string { return `oexec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export async function executeGuardedTwoLegOrder(input: {
  orderPlanId: string;
  dryRun?: boolean;
  explicitConfirm?: string;
}): Promise<TwoLegOrderExecutionResult> {
  const dryRun = input.dryRun !== false;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const id = makeId();
  const now = new Date().toISOString();

  // 1-2. Load orderPlan
  const plan = await findOrderPlanById(input.orderPlanId);
  if (!plan) return execResult(id, input.orderPlanId, "binance" as any, "unknown", "failed", blockers, warnings, now, ["order plan not found"]);
  if (plan.status !== "validated") return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "failed", blockers, warnings, now, [`order plan status: ${plan.status}`]);

  // 3. Expiry
  if (new Date(plan.expiresAtUtc).getTime() < Date.now()) {
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "failed", blockers, warnings, now, ["order plan expired"]);
  }

  // 4. Exchange check
  if (plan.exchange !== "binance") return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "failed", blockers, warnings, now, [`${plan.exchange} not supported`]);

  // 5. Settings
  let settings: any;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    settings = await loadSettings();
  } catch (e: any) {
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "frozen", blockers, warnings, now, [`settings load failed: ${e.message}`]);
  }
  if (!settings.execution.allowRealOrders) blockers.push("allowRealOrders not true");

  // 6-7. Dry run / env / confirm
  if (!dryRun) {
    if (process.env.V121_ENABLE_REAL_ORDER_EXECUTION !== "1") blockers.push("V121_ENABLE_REAL_ORDER_EXECUTION not set");
    if (input.explicitConfirm !== "EXECUTE_REAL_TWO_LEG_ORDER") blockers.push("explicit_confirm_required");
  }

  // 8. Kill switch
  const ksRaw = process.env.V121_KILL_SWITCH;
  const ks = (ksRaw && ksRaw !== "undefined" ? ksRaw : "OFF") as string;
  if (ks !== "OFF") blockers.push(`kill switch: ${ks}`);

  // 9. Amount check
  const maxOrder = settings.notional?.maxOrderNotionalUsdt ?? 50;
  if (plan.plannedNotionalUsdt > maxOrder) blockers.push(`notional ${plan.plannedNotionalUsdt} > max ${maxOrder}`);

  if (blockers.length > 0) {
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "failed", blockers, warnings, now);
  }

  // 10. Re-run preOrderGate
  try {
    const { runPreOrderExecutionGate } = await import("./preOrderExecutionGate");
    const gate = await runPreOrderExecutionGate({
      intentId: plan.intentId, decisionId: plan.decisionId,
      exchange: plan.exchange, symbol: plan.symbol,
      plannedNotionalUsdt: plan.plannedNotionalUsdt,
    });
    if (!gate.ok) blockers.push(...gate.blockers.slice(0, 3));
  } catch (e: any) {
    blockers.push(`gate error: ${e.message}`);
  }

  // 11. Open orders
  try {
    const { adapter } = createAccountAdapter(plan.exchange);
    const openOrders = await adapter.fetchOpenOrders();
    const conflict = openOrders.filter((o: any) => o.symbol === plan.symbol);
    if (conflict.length > 0) blockers.push(`${conflict.length} open orders for ${plan.symbol}`);
  } catch { blockers.push("open order check failed"); }

  if (blockers.length > 0) {
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "frozen", blockers, warnings, now);
  }

  // 12. Create adapter
  const { adapter } = createAccountAdapter(plan.exchange);

  // 13. Create initial ledger
  const initial: TwoLegOrderExecutionResult = {
    ok: false, id, orderPlanId: input.orderPlanId,
    exchange: plan.exchange, symbol: plan.symbol,
    status: dryRun ? "dry_run" : "submitted_spot",
    blockers, warnings,
    createdAtUtc: now, updatedAtUtc: now,
  };
  await saveOrderExecution(initial);

  // 14. Submit spot BUY
  if (!adapter.submitOrderLeg) {
    await updateOrderExecution(id, { status: "frozen", frozenReason: "adapter_missing_submitOrderLeg" } as any);
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "frozen", [...blockers, "adapter missing submitOrderLeg"], warnings, now);
  }

  const spotResult = await adapter.submitOrderLeg(plan.spotLeg, { dryRun, explicitConfirm: input.explicitConfirm });

  if (!spotResult.ok || spotResult.status === "UNKNOWN" || spotResult.status === "REJECTED") {
    const frozen = spotResult.status === "UNKNOWN" ? "frozen" : "failed";
    await updateOrderExecution(id, { status: frozen, frozenReason: `spot ${spotResult.status}`, spot: spotResult } as any);
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, frozen, [...blockers, `spot ${spotResult.status}: ${spotResult.error ?? "unknown"}`], warnings, now, undefined, spotResult);
  }

  await updateOrderExecution(id, { status: "submitted_spot", spot: spotResult } as any);

  // 15. Submit perp SHORT
  const perpResult = await adapter.submitOrderLeg(plan.perpLeg, { dryRun, explicitConfirm: input.explicitConfirm });

  if (!perpResult.ok || perpResult.status === "UNKNOWN" || perpResult.status === "REJECTED") {
    const frozen = perpResult.status === "UNKNOWN" ? "frozen" : "failed";
    await updateOrderExecution(id, { status: frozen, frozenReason: `perp ${perpResult.status}`, spot: spotResult, perp: perpResult } as any);
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, frozen, [...blockers, `perp ${perpResult.status}: ${perpResult.error ?? "unknown"}`], warnings, now, undefined, spotResult, perpResult);
  }

  await updateOrderExecution(id, { status: "both_submitted", spot: spotResult, perp: perpResult } as any);

  if (dryRun) {
    return execResult(id, input.orderPlanId, plan.exchange, plan.symbol, "dry_run", blockers, warnings, now, undefined, spotResult, perpResult);
  }

  // 16-25. Query final status
  const finalStatus = await queryExecutionFinalStatus(id, plan.symbol, spotResult, perpResult, adapter);
  return finalStatus;
}

async function queryExecutionFinalStatus(
  id: string, symbol: string,
  spot: import("./orderExecutionTypes").ExchangeOrderSubmissionResult,
  perp: import("./orderExecutionTypes").ExchangeOrderSubmissionResult,
  adapter: any,
): Promise<TwoLegOrderExecutionResult> {
  let spotFinal = spot;
  let perpFinal = perp;
  const blockers: string[] = [];

  // Query spot
  if (adapter.fetchOrderByClientOrderId && spot.clientOrderId) {
    try {
      const sr = await adapter.fetchOrderByClientOrderId({ symbol, market: "spot", clientOrderId: spot.clientOrderId });
      if (sr.status !== "UNKNOWN") spotFinal = sr;
    } catch { /* keep original */ }
  }

  // Query perp
  if (adapter.fetchOrderByClientOrderId && perp.clientOrderId) {
    try {
      const pr = await adapter.fetchOrderByClientOrderId({ symbol, market: "perp", clientOrderId: perp.clientOrderId });
      if (pr.status !== "UNKNOWN") perpFinal = pr;
    } catch { /* keep original */ }
  }

  let status: OrderExecutionStatus;
  let frozenReason: string | undefined;

  if (spotFinal.status === "UNKNOWN" || perpFinal.status === "UNKNOWN") {
    status = "frozen";
    frozenReason = spotFinal.status === "UNKNOWN" ? "spot_unknown" : "perp_unknown";
  } else if (spotFinal.status === "PARTIALLY_FILLED" || perpFinal.status === "PARTIALLY_FILLED") {
    status = "partial";
    frozenReason = "partial_fill";
  } else if (spotFinal.status === "FILLED" && perpFinal.status === "FILLED") {
    status = "filled";
  } else {
    status = "both_submitted";
  }

  const result = {
    ok: status === "filled",
    id, orderPlanId: "", exchange: "binance" as const, symbol,
    status, blockers, warnings: [],
    frozenReason,
    spot: spotFinal,
    perp: perpFinal,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
  };
  await updateOrderExecution(id, { status, frozenReason, spot: spotFinal, perp: perpFinal } as any);
  return result;
}

function execResult(
  id: string, orderPlanId: string, exchange: import("../domain/types").ExchangeId, symbol: string,
  status: OrderExecutionStatus, blockers: string[], warnings: string[], now: string,
  blockerMsgs?: string[], spot?: any, perp?: any,
): TwoLegOrderExecutionResult {
  const allBlockers = [...blockers];
  if (blockerMsgs) allBlockers.push(...blockerMsgs);
  return {
    ok: false, id, orderPlanId, exchange, symbol, status,
    blockers: allBlockers, warnings, frozenReason: status === "frozen" || status === "failed" ? allBlockers[0] : undefined,
    spot, perp, createdAtUtc: now, updatedAtUtc: now,
  };
}
