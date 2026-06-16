import type { ExchangeId } from "../domain/types";
import { NET_PROFIT_THRESHOLDS } from "../domain/constants";

export interface NetProfitInput {
  path: { spotExchange: ExchangeId; perpExchange: ExchangeId };
  entryBasis: number;
  expectedExitBasis: number;
  funding8h: number;
  fundingCycles: number;
  secondsToNextFunding: number;
  plannedNotional: number;
  makerRate: number;
  takerRate: number;
  isTakerEntry: boolean;
  spotSlippage: number;
  perpSlippage: number;
  phase: "tiny" | "controlled" | "mature";
}

export interface NetProfitResult {
  entryBasis: number;
  exitBasisCost: number;
  grossFunding: number;
  fundingDecay: number;
  fundingAfterDecay: number;
  feeCost: number;
  slippageCost: number;
  riskDiscount: number;
  totalCost: number;
  expectedNetRate: number;
  expectedNetProfit: number;
  minRequiredRate: number;
  minRequiredProfit: number;
  passed: boolean;
}

export function calcNetProfit(input: NetProfitInput): NetProfitResult {
  const exitBasisCost = input.expectedExitBasis;

  const { decayedFunding } = calcFundingDecay(input.funding8h, input.fundingCycles, input.secondsToNextFunding);

  const feeRate = input.isTakerEntry ? input.takerRate : input.makerRate;
  const feeCost = feeRate * 4;

  const slippageCost = (input.spotSlippage + input.perpSlippage);

  const riskDiscount = calcRiskDiscount(input.path);

  const expectedNetRate = Math.max(0,
    input.entryBasis - exitBasisCost + decayedFunding - feeCost - slippageCost - riskDiscount
  );

  const expectedNetProfit = expectedNetRate * input.plannedNotional;

  const minRequiredRate = getMinRequiredRate(input.path);
  const minRequiredProfit = getMinRequiredProfit(input.phase);
  const passed = expectedNetRate >= minRequiredRate && expectedNetProfit >= minRequiredProfit;

  return {
    entryBasis: input.entryBasis,
    exitBasisCost,
    grossFunding: input.funding8h * input.fundingCycles,
    fundingDecay: (input.funding8h * input.fundingCycles) - decayedFunding,
    fundingAfterDecay: decayedFunding,
    feeCost,
    slippageCost,
    riskDiscount,
    totalCost: exitBasisCost + feeCost + slippageCost + riskDiscount,
    expectedNetRate,
    expectedNetProfit,
    minRequiredRate,
    minRequiredProfit,
    passed,
  };
}

export function calcFundingDecay(
  funding8h: number,
  cycles: number,
  secondsToNextFunding: number
): { decayedFunding: number; decayDescription: string } {
  if (cycles <= 0 || funding8h <= 0) return { decayedFunding: 0, decayDescription: "无资金费收益" };

  let totalDecayed = 0;
  let desc = "";

  for (let i = 0; i < cycles; i++) {
    let ratio: number;
    if (i === 0) {
      if (secondsToNextFunding < 30 * 60) ratio = 1.0;
      else if (secondsToNextFunding < 120 * 60) ratio = 0.8;
      else if (secondsToNextFunding < 240 * 60) ratio = 0.6;
      else ratio = 0.4;
      desc = `第1周期(${Math.floor(secondsToNextFunding / 60)}min)×${(ratio * 100).toFixed(0)}%`;
    } else if (i === 1) {
      ratio = 0.5;
      desc += ` + 第2周期×50%`;
    } else {
      ratio = 0.01;
      desc += ` + 第${i + 1}周期×1%`;
    }
    totalDecayed += funding8h * ratio;
  }

  return { decayedFunding: totalDecayed, decayDescription: desc };
}

function calcRiskDiscount(path: { spotExchange: string; perpExchange: string }): number {
  if (path.spotExchange === path.perpExchange) {
    return path.spotExchange === "htx" ? 0.0015 : 0.0005;
  }
  const hasHtx = path.spotExchange === "htx" || path.perpExchange === "htx";
  return hasHtx ? 0.0025 : 0.0015;
}

function getMinRequiredRate(path: { spotExchange: string; perpExchange: string }): number {
  const key = `${path.spotExchange}:${path.perpExchange}`;
  return NET_PROFIT_THRESHOLDS[key] ?? 0.007;
}

function getMinRequiredProfit(phase: "tiny" | "controlled" | "mature"): number {
  switch (phase) {
    case "tiny": return 5;
    case "controlled": return 10;
    case "mature": return 20;
  }
}
