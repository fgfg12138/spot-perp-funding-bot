/**
 * 受保护平仓执行器 — 真实平仓闭环的核心执行逻辑。
 *
 * 严格边界（与 guardedOrderExecutor 对称，但平仓专属）：
 * - 平仓腿顺序：先永续 BUY 平空 → 再现货 SELL。
 *   若现货先卖而永续平空失败，会留下裸空头（无对冲，风险无限）。
 *   反之永续先平若现货卖出失败，剩多头现货无空头（已对冲，风险有限）→ protected。
 * - 任何失败 / 未知 / 部分成交 / 验证失败 → protected（position FROZEN），不自动重试、不自动补腿。
 * - ledger-before-submission：提交前先写一行（status=prechecked, ok=false），提交后逐步更新。
 * - 平仓后验证：重新查询交易所仓位/余额，不只信任订单状态。
 * - kill switch EXIT 在 PAUSE_NEW_ENTRIES 下仍允许；PAUSE_ALL_AUTOMATION 下禁止。
 * - 真实平仓门控独立于开仓（V121_ENABLE_REAL_CLOSE_EXECUTION + EXECUTE_REAL_CLOSE_POSITION）。
 */
import type { PaperExecution } from "../execution/paperLifecycle";
import type { ExchangeOrderSubmissionResult } from "../execution/orderExecutionTypes";
import type { ExchangeId } from "../domain/types";
import type {
  ClosePlan,
  CloseExecutionResult,
  CloseExecutionStatus,
  CloseVerificationResult,
  ClosePnlEstimate,
  ExchangeAccountSnapshot,
} from "./closeExecutionTypes";
import { findClosePlanById } from "./closePlanLedger";
import { saveCloseExecution, updateCloseExecution } from "./closeExecutionLedger";
import { runClosePrecheckGate } from "./closePrecheckGate";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";
import { paperStore } from "../execution/paperStore";
import { closePosition, freezeExecution } from "../execution/paperLifecycle";

function makeId(): string {
  return `cexec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const EPS = 1e-8;

export interface ExecuteCloseInput {
  closePlanId: string;
  /** dryRun=true 时不下单，只走校验链并返回 prechecked。 */
  dryRun?: boolean;
  /** 后端确认串：EXECUTE_REAL_CLOSE_POSITION（来自用户 CONFIRM_CLOSE_POSITION 映射）。 */
  explicitConfirm?: string;
  /** 触发原因（传递给 precheckGate 用于冻结等级判断）。 */
  triggerReason?: "normal_tp" | "hard_stop_loss" | "margin_risk" | "manual";
}

/**
 * 执行受保护平仓。返回 CloseExecutionResult，并已持久化到 close_execution_ledger。
 *
 * dryRun=true：只走校验链，不下单，status=prechecked。
 * dryRun=false：提交两腿 + 平仓后验证 + 更新 position 状态。
 */
export async function executeGuardedClose(input: ExecuteCloseInput): Promise<CloseExecutionResult> {
  const dryRun = input.dryRun !== false;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const id = makeId();
  const now = new Date().toISOString();

  // 1. 加载 ClosePlan
  const plan = await findClosePlanById(input.closePlanId);
  if (!plan) {
    return makeResult(id, "binance" as ExchangeId, "unknown", "failed", blockers, warnings, now, ["close plan not found"]);
  }
  // finalize 闭包：从 plan 补全 positionId + closePlanId
  const finalize = (r: CloseExecutionResult): CloseExecutionResult => ({
    ...r,
    positionId: plan.positionId,
    closePlanId: plan.id,
  });

  // 2. 方案状态
  if (plan.status !== "validated") {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now, [`close plan status: ${plan.status}`]));
  }

  // 3. 过期
  if (new Date(plan.expiresAtUtc).getTime() < Date.now()) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now, ["close plan expired"]));
  }

  // 4. 交易所边界
  if (plan.exchange !== "binance") {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now, [`${plan.exchange} not supported`]));
  }

  // 5. 加载系统记录仓位
  const position = paperStore.findById(plan.positionId);
  if (!position) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now, ["position not found in paper store"]));
  }

  // 6. 真实平仓门控 + 确认串
  if (!dryRun) {
    if (process.env.V121_ENABLE_REAL_CLOSE_EXECUTION !== "1") {
      blockers.push("V121_ENABLE_REAL_CLOSE_EXECUTION not set");
    }
    if (input.explicitConfirm !== "EXECUTE_REAL_CLOSE_POSITION") {
      blockers.push("explicit_confirm_required");
    }
  }

  // 7. kill switch
  const ks = process.env.V121_KILL_SWITCH ?? "OFF";
  if (ks === "PAUSE_ALL_AUTOMATION") blockers.push("kill switch PAUSE_ALL_AUTOMATION");
  else if (ks === "READ_ONLY_ONLY") blockers.push("kill switch READ_ONLY_ONLY");

  if (blockers.length > 0) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now));
  }

  // 8. 获取最新交易所快照（ground truth）
  const { adapter } = createAccountAdapter(plan.exchange);
  let snapshot: ExchangeAccountSnapshot;
  try {
    snapshot = await fetchExchangeSnapshot(adapter, plan.symbol);
  } catch (e: any) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", blockers, warnings, now, [`snapshot fetch failed: ${e.message}`]));
  }

  // 9. 重跑 precheckGate（用最新快照）
  const gate = runClosePrecheckGate({
    position,
    exchangeSnapshot: snapshot,
    triggerReason: input.triggerReason,
    killSwitch: ks,
    realCloseEnabled: !dryRun,
  });
  if (!gate.ok) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "failed", [...blockers, ...gate.blockers], [...warnings, ...gate.warnings], now));
  }
  warnings.push(...gate.warnings);

  // 10. ledger-before-submission
  const initial: CloseExecutionResult = {
    ok: false,
    id,
    positionId: plan.positionId,
    closePlanId: plan.id,
    exchange: plan.exchange,
    symbol: plan.symbol,
    status: "prechecked",
    blockers,
    warnings,
    createdAtUtc: now,
    updatedAtUtc: now,
  };
  await saveCloseExecution(initial);

  // dryRun 到此为止
  if (dryRun) {
    return finalize(makeResult(id, plan.exchange, plan.symbol, "prechecked", blockers, warnings, now));
  }

  // 11. 提交永续 BUY 平空（第一腿）
  if (!adapter.submitOrderLeg) {
    await updateCloseExecution(id, { status: "protected", frozenReason: "adapter_missing_submitOrderLeg" });
    freezePosition(position, "adapter missing submitOrderLeg");
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, "adapter missing submitOrderLeg"], warnings, now));
  }

  let perpResult: ExchangeOrderSubmissionResult;
  try {
    perpResult = await adapter.submitOrderLeg(plan.perpLeg, {
      dryRun: false,
      explicitConfirm: input.explicitConfirm,
    });
  } catch (e: any) {
    await updateCloseExecution(id, { status: "protected", frozenReason: `perp submit error: ${e.message}` });
    freezePosition(position, `perp submit error: ${e.message}`);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, `perp submit error: ${e.message}`], warnings, now));
  }

  await updateCloseExecution(id, { status: "perp_submitted", perpCloseOrder: perpResult });

  // 查询永续最终状态
  const perpFinal = await queryLegFinal(adapter, plan.symbol, "perp", perpResult);

  if (perpFinal.status === "UNKNOWN" || perpFinal.status === "REJECTED" || perpFinal.status === "EXPIRED" || perpFinal.status === "CANCELED") {
    const reason = `perp ${perpFinal.status}`;
    await updateCloseExecution(id, { status: "protected", perpCloseOrder: perpFinal, frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal));
  }

  // 部分成交 → protected（不自动补腿）
  if (perpFinal.status === "PARTIALLY_FILLED") {
    const reason = "perp partially filled";
    await updateCloseExecution(id, { status: "protected", perpCloseOrder: perpFinal, frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal));
  }

  // 永续已成交
  await updateCloseExecution(id, { status: "perp_filled", perpCloseOrder: perpFinal });

  // 12. 提交现货 SELL（第二腿）
  let spotResult: ExchangeOrderSubmissionResult;
  try {
    spotResult = await adapter.submitOrderLeg(plan.spotLeg, {
      dryRun: false,
      explicitConfirm: input.explicitConfirm,
    });
  } catch (e: any) {
    // 现货提交异常：永续已平，现货未卖 → protected（已对冲方向，风险有限）
    const reason = `spot submit error: ${e.message}`;
    await updateCloseExecution(id, { status: "protected", spotCloseOrder: undefined, frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal));
  }

  await updateCloseExecution(id, { status: "spot_submitted", spotCloseOrder: spotResult });

  const spotFinal = await queryLegFinal(adapter, plan.symbol, "spot", spotResult);

  if (spotFinal.status === "UNKNOWN" || spotFinal.status === "REJECTED" || spotFinal.status === "EXPIRED" || spotFinal.status === "CANCELED") {
    const reason = `spot ${spotFinal.status}`;
    await updateCloseExecution(id, { status: "protected", spotCloseOrder: spotFinal, frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal, spotFinal));
  }

  if (spotFinal.status === "PARTIALLY_FILLED") {
    const reason = "spot partially filled";
    await updateCloseExecution(id, { status: "protected", spotCloseOrder: spotFinal, frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal, spotFinal));
  }

  // 双腿成交
  await updateCloseExecution(id, { status: "spot_filled", spotCloseOrder: spotFinal });

  // 13. 平仓后验证（重新查询交易所，不只信任订单状态）
  let verification: CloseVerificationResult;
  try {
    verification = await verifyClose(adapter, plan, perpFinal, spotFinal);
  } catch (e: any) {
    // 验证查询失败 → protected（无法确认）
    const reason = `verification query failed: ${e.message}`;
    await updateCloseExecution(id, { status: "protected", frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal, spotFinal));
  }

  await updateCloseExecution(id, { verification });

  if (!verification.perpShortCleared || !verification.spotBalanceReduced || !verification.executedQtyMatched) {
    // 验证失败 → protected
    const reason = `verification failed: ${verification.differences.join("; ")}`;
    await updateCloseExecution(id, { status: "protected", frozenReason: reason });
    freezePosition(position, reason);
    return finalize(makeResult(id, plan.exchange, plan.symbol, "protected", [...blockers, reason], warnings, now, undefined, perpFinal, spotFinal, undefined, verification));
  }

  // 14. 验证通过 → closed，更新 position 为 CLOSED，估算收益
  const pnl = estimateClosePnl(position, plan, perpFinal, spotFinal);
  await updateCloseExecution(id, { status: "closed", finalPnlEstimate: pnl });
  closePositionInStore(position);

  return finalize(makeResult(id, plan.exchange, plan.symbol, "closed", blockers, warnings, now, undefined, perpFinal, spotFinal, pnl, verification));
}

// ── helpers ──────────────────────────────────────────────────

async function fetchExchangeSnapshot(adapter: any, symbol: string): Promise<ExchangeAccountSnapshot> {
  const [balances, positions, openOrders] = await Promise.all([
    adapter.fetchBalances(),
    adapter.fetchPositions(),
    adapter.fetchOpenOrders(),
  ]);
  const base = symbol.split("/")[0];
  const spotBalance = (balances as any[]).find((b: any) => b.asset === base) ?? null;
  const perpShortPosition = (positions as any[]).find(
    (p: any) => p.symbol === symbol && p.side === "perp_short",
  ) ?? null;
  return {
    exchange: adapter.exchangeId,
    spotBalance: spotBalance ?? null,
    perpShortPosition: perpShortPosition ?? null,
    openOrders: openOrders as any[],
    fetchedAtUtc: new Date().toISOString(),
  };
}

async function queryLegFinal(
  adapter: any,
  symbol: string,
  market: "spot" | "perp",
  initial: ExchangeOrderSubmissionResult,
): Promise<ExchangeOrderSubmissionResult> {
  if (!adapter.fetchOrderByClientOrderId || !initial.clientOrderId) return initial;
  try {
    const queried = await adapter.fetchOrderByClientOrderId({
      symbol,
      market,
      clientOrderId: initial.clientOrderId,
    });
    if (queried.status !== "UNKNOWN") return queried;
  } catch {
    // 查询失败保留初始状态
  }
  return initial;
}

async function verifyClose(
  adapter: any,
  plan: ClosePlan,
  perpFinal: ExchangeOrderSubmissionResult,
  spotFinal: ExchangeOrderSubmissionResult,
): Promise<CloseVerificationResult> {
  const snapshot = await fetchExchangeSnapshot(adapter, plan.symbol);
  const perpRemainingQty = snapshot.perpShortPosition?.quantity ?? 0;
  const spotRemainingFree = snapshot.spotBalance?.free ?? 0;
  const differences: string[] = [];

  // 永续 SHORT 应已清零（容忍微小残留）
  const perpShortCleared = perpRemainingQty < EPS;
  if (!perpShortCleared) {
    differences.push(`perp short remaining ${perpRemainingQty} (expected ~0)`);
  }

  // 现货余额应已减少（卖出了 closeQty.spot）
  const spotBalanceReduced = !!spotFinal.executedQty && spotFinal.executedQty > 0;
  if (!spotBalanceReduced) {
    differences.push("spot balance not reduced (executedQty <= 0)");
  }

  // 执行量应匹配计划量（容忍 step 误差）
  const perpExecuted = perpFinal.executedQty ?? 0;
  const spotExecuted = spotFinal.executedQty ?? 0;
  const executedQtyMatched =
    Math.abs(perpExecuted - plan.closeQty.perp) < (plan.perpLeg.constraints.stepSize ?? EPS) &&
    Math.abs(spotExecuted - plan.closeQty.spot) < (plan.spotLeg.constraints.stepSize ?? EPS);
  if (!executedQtyMatched) {
    differences.push(
      `executed qty mismatch: perp ${perpExecuted} vs plan ${plan.closeQty.perp}, spot ${spotExecuted} vs plan ${plan.closeQty.spot}`,
    );
  }

  return {
    perpShortCleared,
    spotBalanceReduced,
    executedQtyMatched,
    perpRemainingQty,
    spotRemainingFree,
    differences,
  };
}

function estimateClosePnl(
  position: PaperExecution,
  plan: ClosePlan,
  perpFinal: ExchangeOrderSubmissionResult,
  spotFinal: ExchangeOrderSubmissionResult,
): ClosePnlEstimate {
  // 粗略估算：基差收益 - 手续费 - 滑点。
  // 真实精确收益需从 funding payment 历史与成交记录聚合，此处给保守估算。
  const perpExecutedQty = perpFinal.executedQty ?? plan.closeQty.perp;
  const spotExecutedQty = spotFinal.executedQty ?? plan.closeQty.spot;
  const minQty = Math.min(perpExecutedQty, spotExecutedQty);

  const spotOpenNotional = position.spotFilledQty * position.spotAvgPrice;
  const perpOpenNotional = position.perpFilledQty * position.perpAvgPrice;
  const spotCloseNotional = spotExecutedQty * (spotFinal.avgPrice ?? plan.spotLeg.estimatedPrice);
  const perpCloseNotional = perpExecutedQty * (perpFinal.avgPrice ?? plan.perpLeg.estimatedPrice);

  // 开仓基差 = perp - spot（开仓时）；平仓基差 = perp - spot（平仓时）
  // 基差收益 ≈ (开仓基差 - 平仓基差) × qty（永续贴水收敛时为正）
  const openBasis = position.perpAvgPrice - position.spotAvgPrice;
  const closeBasis =
    (perpFinal.avgPrice ?? plan.perpLeg.estimatedPrice) -
    (spotFinal.avgPrice ?? plan.spotLeg.estimatedPrice);

  // 手续费粗估 0.04% × 双腿 notional
  const fees = (spotOpenNotional + perpOpenNotional + spotCloseNotional + perpCloseNotional) * 0.0004;
  // 滑点粗估 0.05% × 平仓 notional
  const slippage = (spotCloseNotional + perpCloseNotional) * 0.0005;

  // fundingProfit 未知（需从历史聚合），保守记 0
  const fundingProfit = 0;
  const netProfit = (openBasis - closeBasis) * minQty + fundingProfit - fees - slippage;

  return {
    fundingProfit,
    openBasisImpact: openBasis * minQty,
    closeBasisImpact: closeBasis * minQty,
    fees,
    slippage,
    netProfit,
  };
}

function freezePosition(position: PaperExecution, reason: string): void {
  const frozen = freezeExecution(position, reason);
  paperStore.save(frozen);
}

function closePositionInStore(position: PaperExecution): void {
  const closed = closePosition(position);
  paperStore.save(closed);
}

function makeResult(
  id: string,
  exchange: ExchangeId,
  symbol: string,
  status: CloseExecutionStatus,
  blockers: string[],
  warnings: string[],
  now: string,
  blockerMsgs?: string[],
  perpCloseOrder?: ExchangeOrderSubmissionResult,
  spotCloseOrder?: ExchangeOrderSubmissionResult,
  finalPnlEstimate?: ClosePnlEstimate,
  verification?: CloseVerificationResult,
): CloseExecutionResult {
  const allBlockers = [...blockers];
  if (blockerMsgs) allBlockers.push(...blockerMsgs);
  return {
    ok: status === "closed",
    id,
    positionId: "",
    closePlanId: "",
    exchange,
    symbol,
    status,
    perpCloseOrder,
    spotCloseOrder,
    blockers: allBlockers,
    warnings,
    frozenReason: status === "protected" || status === "failed" ? allBlockers[0] : undefined,
    finalPnlEstimate,
    verification,
    createdAtUtc: now,
    updatedAtUtc: now,
  };
}
