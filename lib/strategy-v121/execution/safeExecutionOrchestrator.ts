/**
 * Safe Execution Orchestrator — 所有真实资金动作的唯一决策入口。
 *
 * 不执行划转，不下单。只做安全决策。
 */
import type { ExchangeId } from "../domain/types";

export type SafeExecutionState =
  | "IDLE"
  | "BLOCKED"
  | "TRANSFER_REQUIRED"
  | "FINAL_AUDIT_READY"
  | "HUMAN_APPROVAL_REQUIRED"
  | "FROZEN"
  | "MANUAL_INTERVENTION_REQUIRED";

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
  sessionId: string;
  intentId: string;
  state: SafeExecutionState;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  actualNotionalUsdt?: number;
  blockers: string[];
  warnings: string[];
  orderConstraintPass: boolean;
  capitalPrecheckPass: boolean;
  needsAutoTransfer: boolean;
  transferPlan?: { from: "spot" | "perp"; to: "spot" | "perp"; amountUsdt: number; reason: string };
  requiredNextAction: "none" | "execute_transfer" | "rerun_audit" | "human_approve" | "manual_intervention";
  realExecutionAllowed: false;
  chineseMessage: string;
}

export async function runSafeExecutionDecision(
  input: SafeExecutionInput,
): Promise<SafeExecutionDecision> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sessionId = `sx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 1. simulationOnly → 直接 BLOCKED
  if (input.simulationOnly || input.purpose === "execution_rehearsal") {
    return {
      sessionId, intentId: input.intentId,
      state: "BLOCKED",
      exchange: input.exchange, symbol: input.symbol,
      plannedNotionalUsdt: input.plannedNotionalUsdt,
      blockers: ["模拟候选不允许自动划转或真实下单。"],
      warnings: [], orderConstraintPass: false, capitalPrecheckPass: false,
      needsAutoTransfer: false, requiredNextAction: "none",
      realExecutionAllowed: false,
      chineseMessage: "模拟候选仅用于流程测试，不允许真实划转或下单。",
    };
  }

  // 2. Order constraint precheck
  let constraintPass = false;
  try {
    const { checkOrderConstraint } = await import("./orderConstraintPrecheck");
    const c = await checkOrderConstraint(input.exchange, input.symbol, input.plannedNotionalUsdt);
    constraintPass = c.overallPass;
    if (!c.overallPass) blockers.push(`下单限制预检失败: ${c.chineseMessage}`);
  } catch (err: any) {
    blockers.push(`下单限制预检异常: ${err.message}`);
    return frozen(sessionId, input, blockers, "下单限制预检异常，系统已冻结");
  }

  // 3. Capital precheck
  let capitalPass = false;
  let needsTransfer = false;
  let transferPlan: SafeExecutionDecision["transferPlan"];
  let actualNotional = input.plannedNotionalUsdt;

  try {
    const { runCapitalPrecheck } = await import("./capitalPrecheck");
    const cap = await runCapitalPrecheck(input.exchange, input.symbol, input.plannedNotionalUsdt);
    capitalPass = cap.passBeforeTransfer;
    actualNotional = Math.min(cap.actualNotionalUsdt, input.plannedNotionalUsdt);
    needsTransfer = cap.needsAutoTransfer;
    if (cap.transferPlan) transferPlan = cap.transferPlan;
    if (!cap.passBeforeTransfer && !needsTransfer) {
      blockers.push(`资金预检失败: ${cap.blockReason ?? cap.chineseMessage}`);
    }
  } catch (err: any) {
    blockers.push(`资金预检异常: ${err.message}`);
    return frozen(sessionId, input, blockers, "资金预检异常，系统已冻结");
  }

  // 4. 需要划转 → TRANSFER_REQUIRED
  if (needsTransfer && transferPlan) {
    return {
      sessionId, intentId: input.intentId,
      state: "TRANSFER_REQUIRED",
      exchange: input.exchange, symbol: input.symbol,
      plannedNotionalUsdt: input.plannedNotionalUsdt,
      actualNotionalUsdt: actualNotional,
      blockers, warnings,
      orderConstraintPass: constraintPass,
      capitalPrecheckPass: false,
      needsAutoTransfer: true,
      transferPlan,
      requiredNextAction: "execute_transfer",
      realExecutionAllowed: false,
      chineseMessage: `需要自动内部划转 ${transferPlan.amountUsdt}U (${transferPlan.from}→${transferPlan.to})，划转完成并重新审计前不能下单`,
    };
  }

  // 5. 有 blockers → BLOCKED
  if (blockers.length > 0) {
    return blocked(sessionId, input, blockers, warnings);
  }

  // 6. 全部通过 → FINAL_AUDIT_READY
  return {
    sessionId, intentId: input.intentId,
    state: "FINAL_AUDIT_READY",
    exchange: input.exchange, symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt,
    actualNotionalUsdt: actualNotional,
    blockers, warnings,
    orderConstraintPass: constraintPass,
    capitalPrecheckPass: capitalPass,
    needsAutoTransfer: false,
    requiredNextAction: "human_approve",
    realExecutionAllowed: false,
    chineseMessage: `安全决策通过。actualNotional=${actualNotional.toFixed(2)}U。等待人工确认。`,
  };
}

function blocked(
  sessionId: string, input: SafeExecutionInput,
  blockers: string[], warnings: string[],
): SafeExecutionDecision {
  return {
    sessionId, intentId: input.intentId,
    state: "BLOCKED",
    exchange: input.exchange, symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt,
    blockers, warnings,
    orderConstraintPass: false, capitalPrecheckPass: false,
    needsAutoTransfer: false, requiredNextAction: "none",
    realExecutionAllowed: false,
    chineseMessage: `安全决策未通过: ${blockers.join("；")}`,
  };
}

function frozen(
  sessionId: string, input: SafeExecutionInput,
  blockers: string[], message: string,
): SafeExecutionDecision {
  return {
    sessionId, intentId: input.intentId,
    state: "FROZEN",
    exchange: input.exchange, symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt,
    blockers, warnings: [],
    orderConstraintPass: false, capitalPrecheckPass: false,
    needsAutoTransfer: false, requiredNextAction: "manual_intervention",
    realExecutionAllowed: false,
    chineseMessage: message,
  };
}
