import type { RiskDecision, PositionSnapshot } from "../domain/types";
import { arbitrateRisk, type RiskArbiterInput } from "../risk/riskArbiter";
import { calcComboPnl } from "../risk/comboPnl";

export interface RiskServiceInput {
  position: PositionSnapshot;
  totalEquity: number;
  peakEquity: number;
  phase: "test" | "stable" | "mature";
  depthDeclinePercent: number;
  spreadChangeRatio: number;
}

export interface RiskServiceResult {
  decision: RiskDecision;
  comboLoss: number;
}

export function evaluatePositionRisk(input: RiskServiceInput): RiskServiceResult {
  const { position, totalEquity, peakEquity, phase, depthDeclinePercent, spreadChangeRatio } = input;

  const spotNotional = position.spotQty * position.spotAvgPrice;
  const perpNotional = position.perpQty * position.perpAvgPrice;

  const comboPnl = calcComboPnl({
    spotEntryAvgPrice: position.spotAvgPrice,
    spotQty: position.spotQty,
    spotExitVwapNow: position.currentBasis > 0
      ? position.spotAvgPrice * (1 - position.currentBasis)
      : position.spotAvgPrice,
    perpEntryAvgPrice: position.perpAvgPrice,
    perpQty: position.perpQty,
    perpMarkPrice: position.markPrice,
    contractMultiplier: 1,
    realizedFunding: position.realizedFunding,
    feesPaid: 0, slippageCost: 0, otherCost: 0,
  });

  const arbiterInput: RiskArbiterInput = {
    spotNotional, perpNotional, comboLoss: comboPnl.comboLoss,
    totalEquity, peakEquity, adlLevel: position.adlLevel ?? "low",
    depthDeclinePercent, spreadChangeRatio, phase,
  };

  const decision = arbitrateRisk(arbiterInput);
  return { decision, comboLoss: comboPnl.comboLoss };
}
