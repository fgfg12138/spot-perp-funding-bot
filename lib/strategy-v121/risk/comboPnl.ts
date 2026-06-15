export interface ComboPnlInput {
  spotEntryAvgPrice: number;
  spotQty: number;
  spotExitVwapNow: number;

  perpEntryAvgPrice: number;
  perpQty: number;
  perpMarkPrice: number;
  contractMultiplier: number;

  realizedFunding: number;
  feesPaid: number;
  slippageCost: number;
  otherCost: number;
}

export interface ComboPnlResult {
  spotUnrealizedPnl: number;
  perpUnrealizedPnl: number;
  grossPnl: number;
  totalCost: number;
  comboNetPnl: number;
  comboLoss: number;
}

export function calcComboPnl(input: ComboPnlInput): ComboPnlResult {
  const spotUnrealizedPnl = (input.spotExitVwapNow - input.spotEntryAvgPrice) * input.spotQty;

  const perpUnrealizedPnl = (input.perpEntryAvgPrice - input.perpMarkPrice)
    * input.perpQty * input.contractMultiplier;

  const grossPnl = spotUnrealizedPnl + perpUnrealizedPnl;
  const totalCost = input.feesPaid + input.slippageCost + input.otherCost;
  const comboNetPnl = grossPnl + input.realizedFunding - totalCost;
  const comboLoss = Math.max(0, -comboNetPnl);

  return { spotUnrealizedPnl, perpUnrealizedPnl, grossPnl, totalCost, comboNetPnl, comboLoss };
}

export function checkHardStopLoss(
  comboLoss: number,
  totalEquity: number,
  phase: "test" | "stable" | "mature"
): { triggered: boolean; threshold: number; lossRatio: number } {
  const thresholdMap = { test: 0.002, stable: 0.003, mature: 0.005 };
  const threshold = thresholdMap[phase];
  const lossRatio = totalEquity > 0 ? comboLoss / totalEquity : 0;
  return { triggered: lossRatio >= threshold, threshold, lossRatio };
}

export function checkDrawdown(
  peakEquity: number,
  currentEquity: number
): { drawdown: number; action: string } {
  if (peakEquity <= 0) return { drawdown: 0, action: "正常" };
  const dd = (peakEquity - currentEquity) / peakEquity;

  if (dd >= 0.10) return { drawdown: dd, action: "清空非核心持仓，暂停交易24小时" };
  if (dd >= 0.08) return { drawdown: dd, action: "主动减仓，只保留最稳路径" };
  if (dd >= 0.05) return { drawdown: dd, action: "暂停所有新开仓，只管理已有仓位" };
  if (dd >= 0.03) return { drawdown: dd, action: "仓位减半，暂停HTX和小币" };
  return { drawdown: dd, action: "正常" };
}
