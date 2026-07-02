import type { PositionSnapshot, RiskDecision, ADLLevel, ArbitragePath, HealthStatus } from "../domain/types";
import { calcPositionDeviation, evaluateDeviation } from "../execution/deviation";
import { calcComboPnl } from "../risk/comboPnl";
import { shouldExitPosition, type ExitCheckInput } from "./exitRules";

export interface MonitorInput {
  position: PositionSnapshot;
  spotMarketPrice: number;
  perpMarkPrice: number;
  nextFundingRate: number;
  holdingHours: number;
}

export interface MonitorOutput {
  position: PositionSnapshot;
  action: "hold" | "exit" | "reduce" | "freeze";
  reason: string;
  riskDecision?: RiskDecision;
}

/**
 * Monitor a position and recommend an action.
 */
export function monitorPosition(input: MonitorInput): MonitorOutput {
  const { position, spotMarketPrice, perpMarkPrice, nextFundingRate, holdingHours } = input;

  // Update position snapshot
  const updated: PositionSnapshot = {
    ...position,
    timestampUtc: Date.now(),
    currentBasis: position.currentBasis,
    markPrice: perpMarkPrice,
    funding8h: nextFundingRate,
  };

  // Check exit rules
  const exitCheck: ExitCheckInput = {
    currentExitBasis: position.currentBasis,
    entryBasis: position.currentBasis + 0.005, // approximate
    expectedNetRate: 0.004,
    actualNetProfit: position.realizedFunding,
    targetNetProfit: 5,
    nextFundingRate,
    holdingHours,
    isHtxOrSmallCoin: position.path.perpExchange === "htx",
  };

  const exitDecision = shouldExitPosition(exitCheck);
  if (exitDecision.shouldExit) {
    return { position: updated, action: "exit", reason: exitDecision.reason };
  }

  // Check deviation
  const deviation = calcPositionDeviation(
    position.spotQty * position.spotAvgPrice,
    position.perpQty * position.perpAvgPrice
  );
  const devLevel = evaluateDeviation(deviation);
  if (devLevel.level === "emergency") {
    return { position: updated, action: "freeze",
      reason: `仓位偏差 ${(deviation * 100).toFixed(2)}% > 5%`,
      riskDecision: { action: "emergency", priority: 1,
        reason: { type: "deviation", severity: "critical" },
        detail: "仓位偏差过高" }};
  }
  if (devLevel.level === "pause") {
    return { position: updated, action: "reduce",
      reason: `仓位偏差 ${(deviation * 100).toFixed(2)}% 3%-5%`,
      riskDecision: { action: "reduce", priority: 2,
        reason: { type: "deviation", severity: "warning" },
        detail: "仓位偏差过高，需修复" }};
  }

  return { position: updated, action: "hold", reason: "正常持仓" };
}
