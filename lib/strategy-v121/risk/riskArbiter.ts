import type { RiskDecision, RiskReason, ADLLevel } from "../domain/types";
import { evaluateDeviation, calcPositionDeviation } from "../execution/deviation";
import { checkHardStopLoss, checkDrawdown } from "./comboPnl";

export interface RiskArbiterInput {
  spotNotional: number;
  perpNotional: number;
  comboLoss: number;
  totalEquity: number;
  peakEquity: number;
  adlLevel: ADLLevel;
  depthDeclinePercent: number;
  spreadChangeRatio: number;
  phase: "test" | "stable" | "mature";
}

export function arbitrateRisk(input: RiskArbiterInput): RiskDecision {
  // 1. 仓位偏差检查
  const deviation = calcPositionDeviation(input.spotNotional, input.perpNotional);
  const devLevel = evaluateDeviation(deviation);
  if (devLevel.level === "emergency") {
    return {
      action: "emergency", priority: 1,
      reason: { type: "deviation", severity: "critical" },
      detail: `仓位偏差 ${(deviation * 100).toFixed(2)}% > 5%，执行事故`,
    };
  }

  // 2. 硬止损检查
  const stopLoss = checkHardStopLoss(input.comboLoss, input.totalEquity, input.phase);
  if (stopLoss.triggered) {
    return {
      action: "exit", priority: 1,
      reason: { type: "stop_loss", severity: "critical" },
      detail: `组合亏损 $${input.comboLoss.toFixed(2)} (${(stopLoss.lossRatio * 100).toFixed(2)}%) 触发硬止损`,
    };
  }

  // 3. 账户回撤检查
  const dd = checkDrawdown(input.peakEquity, input.totalEquity);
  if (dd.drawdown >= 0.10) {
    return { action: "exit", priority: 1, reason: { type: "drawdown", severity: "critical" }, detail: dd.action };
  }
  if (dd.drawdown >= 0.08) {
    return { action: "reduce", priority: 1, reason: { type: "drawdown", severity: "critical" }, detail: dd.action };
  }
  if (dd.drawdown >= 0.05) {
    return { action: "reduce", priority: 2, reason: { type: "drawdown", severity: "warning" }, detail: dd.action };
  }
  if (dd.drawdown >= 0.03) {
    return { action: "reduce", priority: 2, reason: { type: "drawdown", severity: "warning" }, detail: dd.action };
  }

  // 4. ADL 风险
  if (input.adlLevel === "high") {
    return { action: "exit", priority: 1, reason: { type: "adl", severity: "critical" }, detail: "ADL高风险，主动退出" };
  }
  if (input.adlLevel === "medium_high") {
    return { action: "reduce", priority: 2, reason: { type: "adl", severity: "warning" }, detail: "ADL中高风险，减仓30%-50%" };
  }
  if (input.adlLevel === "medium") {
    return { action: "reduce", priority: 3, reason: { type: "adl", severity: "warning" }, detail: "ADL中等风险，禁止加仓" };
  }

  // 5. 流动性恶化
  if (input.depthDeclinePercent >= 0.70) {
    return { action: "exit", priority: 2, reason: { type: "liquidity", severity: "critical" }, detail: "盘口深度下降70%+，优先退出" };
  }
  if (input.depthDeclinePercent >= 0.50) {
    return { action: "reduce", priority: 2, reason: { type: "liquidity", severity: "warning" }, detail: "盘口深度下降50%+，减仓" };
  }
  if (input.spreadChangeRatio >= 3) {
    return { action: "reduce", priority: 2, reason: { type: "liquidity", severity: "warning" }, detail: "买卖价差扩大3倍，减仓或退出" };
  }
  if (input.spreadChangeRatio >= 2) {
    return { action: "reduce", priority: 3, reason: { type: "liquidity", severity: "warning" }, detail: "买卖价差扩大2倍，禁止加仓" };
  }

  // 6. 仓位偏差 1-3%
  if (devLevel.level === "repair") {
    return {
      action: "repair", priority: 3,
      reason: { type: "deviation", severity: "warning" },
      detail: `仓位偏差 ${(deviation * 100).toFixed(2)}%，修正，不允许继续加仓`,
    };
  }

  return { action: "none", priority: 10, reason: { type: "stop_loss", severity: "info" }, detail: "正常" };
}
