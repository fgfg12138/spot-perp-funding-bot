/**
 * Safe Execution Orchestrator — 所有真实资金动作的唯一决策入口。
 *
 * 不执行划转，不下单。只做安全决策。
 */
import type { ExchangeId } from "../domain/types";

export type SafeExecutionState =
  | "BLOCKED" | "TRANSFER_REQUIRED" | "FINAL_AUDIT_READY"
  | "HUMAN_APPROVAL_REQUIRED" | "FROZEN";

export type SafeExecutionPurpose = "real_arbitrage" | "execution_rehearsal";

export interface SafeExecutionInput {
  intentId: string;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  purpose: SafeExecutionPurpose;
  simulationOnly: boolean;
  realTradeEligible: boolean;
}

export interface SafeExecutionDecision {
  sessionId: string; intentId: string;
  state: SafeExecutionState;
  exchange: ExchangeId; symbol: string;
  plannedNotionalUsdt: number; actualNotionalUsdt?: number;
  blockers: string[]; warnings: string[];
  orderConstraintPass: boolean; capitalPrecheckPass: boolean;
  needsAutoTransfer: boolean;
  autoTransferExecutable?: boolean;
  transferPlan?: { exchange: ExchangeId; asset: "USDT"; fromAccount: "spot" | "perp"; toAccount: "spot" | "perp"; amountUsdt: number; reason: string };
  requiredNextAction: "none" | "execute_transfer" | "rerun_audit" | "human_approve" | "manual_intervention" | "custom_transfer";
  realExecutionAllowed: false;
  settingsApplied?: {
    allowAutoTransfer: boolean;
    transferMode: string;
    maxAutoTransferUsdt: number;
    plannedNotionalUsdt: number;
    maxOrderNotionalUsdt: number;
  };
  chineseMessage: string;
}

const b = (input: SafeExecutionInput, blockers: string[], st: SafeExecutionState = "BLOCKED", next: SafeExecutionDecision["requiredNextAction"] = "none", msg?: string): SafeExecutionDecision => ({
  sessionId: `sx-${Date.now()}`, intentId: input.intentId,
  state: st, exchange: input.exchange, symbol: input.symbol,
  plannedNotionalUsdt: input.plannedNotionalUsdt,
  blockers, warnings: [],
  orderConstraintPass: false, capitalPrecheckPass: false,
  needsAutoTransfer: false, requiredNextAction: next,
  realExecutionAllowed: false,
  chineseMessage: msg ?? `安全决策未通过: ${blockers.join("；")}`,
});

export async function runSafeExecutionDecision(input: SafeExecutionInput): Promise<SafeExecutionDecision> {
  // 修正 4: HTX 必须 BLOCKED
  if (!["binance", "okx"].includes(input.exchange)) {
    return b(input, ["HTX 仅观察，不进入 MAINNET_TINY 安全执行。"]);
  }
  // 修正 5: realTradeEligible 必须为 true
  if (!input.realTradeEligible) {
    return b(input, ["realTradeEligible 不为 true，不允许执行。"]);
  }
  // simulationOnly → BLOCKED
  if (input.simulationOnly || input.purpose === "execution_rehearsal") {
    return b(input, ["模拟候选不允许自动划转或真实下单。"]);
  }

  // 修正 2: orderConstraint → 失败直接 BLOCKED
  let ocp: Awaited<ReturnType<(typeof import("./orderConstraintPrecheck"))["checkOrderConstraint"]>> | undefined;
  try {
    const { checkOrderConstraint } = await import("./orderConstraintPrecheck");
    ocp = await checkOrderConstraint(input.exchange, input.symbol, input.plannedNotionalUsdt);
  } catch (e: any) {
    return b(input, [`下单限制预检异常: ${e.message}`], "FROZEN", "manual_intervention");
  }
  if (!ocp || !ocp.overallPass) {
    return b(input, [`下单限制预检未通过: ${ocp?.chineseMessage ?? "未知"}`], "BLOCKED");
  }

  // 修正 3: capital precheck
  let cp: Awaited<ReturnType<(typeof import("./capitalPrecheck"))["runCapitalPrecheck"]>> | undefined;
  try {
    const { runCapitalPrecheck } = await import("./capitalPrecheck");
    cp = await runCapitalPrecheck(input.exchange, input.symbol, input.plannedNotionalUsdt);
  } catch (e: any) {
    return b(input, [`资金预检异常: ${e.message}`], "FROZEN", "manual_intervention");
  }
  if (!cp) return b(input, ["资金预检返回未知结果"], "BLOCKED");

  // 修正 6: actualNotional ≤ plannedNotional
  const actualNotional = Math.min(cp.actualNotionalUsdt, input.plannedNotionalUsdt);

  // 修正 3: 二次检查 actualNotional 是否 >= minRequired
  if (actualNotional < cp.minRequiredNotionalUsdt) {
    return b(input, [`实际金额 ${actualNotional.toFixed(2)}U < 最小要求 ${cp.minRequiredNotionalUsdt}U`], "BLOCKED");
  }

  // 需要划转 → TRANSFER_REQUIRED（修正 2: 只有 orderConstraint 通过后才到这里）
  if (cp.needsAutoTransfer) {
    let requiredNextAction: SafeExecutionDecision["requiredNextAction"] = "execute_transfer";
    let blockers: string[];
    if (cp.transferMode === "disabled" || !cp.autoTransferAllowed) {
      requiredNextAction = "manual_intervention";
      blockers = ["自动划转未开启，资金不足，请人工处理。"];
    } else if (cp.transferMode === "suggest_only") {
      requiredNextAction = "manual_intervention";
      blockers = ["当前为划转建议模式，请人工划转后重新审计。"];
    } else if (cp.transferMode === "auto_transfer") {
      requiredNextAction = "execute_transfer";
      blockers = ["需要同交易所内部划转，划转后必须重新审计。"];
    } else {
      requiredNextAction = "custom_transfer"; blockers = ["需要内部划转。"];
    }
    return {
      sessionId: `sx-${Date.now()}`, intentId: input.intentId,
      state: "TRANSFER_REQUIRED", exchange: input.exchange, symbol: input.symbol,
      plannedNotionalUsdt: input.plannedNotionalUsdt, actualNotionalUsdt: actualNotional,
      blockers, warnings: [],
      orderConstraintPass: true, capitalPrecheckPass: false,
      needsAutoTransfer: true, transferPlan: cp.transferPlan ? {
        exchange: input.exchange as ExchangeId,
        asset: "USDT" as const,
        fromAccount: cp.transferPlan.from as "spot" | "perp",
        toAccount: cp.transferPlan.to as "spot" | "perp",
        amountUsdt: cp.transferPlan.amountUsdt,
        reason: cp.transferPlan.reason,
      } : undefined,
      autoTransferExecutable: cp.transferMode === "auto_transfer" &&
        (cp.transferPlan?.amountUsdt ?? 0) <= 50 &&
        input.exchange !== "htx",
      requiredNextAction, realExecutionAllowed: false,
      chineseMessage: `需要划转 ${cp.transferPlan?.amountUsdt?.toFixed(2)}U (${cp.transferPlan?.from}→${cp.transferPlan?.to})。`,
      settingsApplied: { allowAutoTransfer: cp.transferMode !== "disabled", transferMode: cp.transferMode ?? "disabled", maxAutoTransferUsdt: 0, plannedNotionalUsdt: input.plannedNotionalUsdt, maxOrderNotionalUsdt: input.plannedNotionalUsdt },
    };
  }

  // 资金不通过且不可划转 → BLOCKED
  if (!cp.passBeforeTransfer) {
    return b(input, [`资金预检未通过: ${cp.blockReason ?? cp.chineseMessage}`], "BLOCKED");
  }

  // 全部通过
  return {
    sessionId: `sx-${Date.now()}`, intentId: input.intentId,
    state: "HUMAN_APPROVAL_REQUIRED", exchange: input.exchange, symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt, actualNotionalUsdt: actualNotional,
    blockers: [], warnings: [],
    orderConstraintPass: true, capitalPrecheckPass: true,
    needsAutoTransfer: false, requiredNextAction: "human_approve",
    realExecutionAllowed: false,
    chineseMessage: `预检全部通过，actual=${actualNotional.toFixed(2)}U。等待人工确认。当前不会真实下单。`,
    settingsApplied: cp.transferMode ? { allowAutoTransfer: cp.autoTransferAllowed, transferMode: cp.transferMode, maxAutoTransferUsdt: 0, plannedNotionalUsdt: input.plannedNotionalUsdt, maxOrderNotionalUsdt: input.plannedNotionalUsdt } : undefined,
  };
}
