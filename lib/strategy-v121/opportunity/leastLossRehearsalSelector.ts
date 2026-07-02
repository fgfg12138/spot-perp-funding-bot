import type { ExchangeId } from "../domain/types";
import { getLatestScan } from "./opportunityStore";
import { calcNetProfit, type NetProfitInput } from "../profitability/netProfit";
import { isSmallCoin } from "../market/contractSpec";
import { getConfig } from "../config/strategyConfig";

interface OpportunityItem {
  [k: string]: unknown;
  path?: Record<string, unknown>;
}

export interface LeastLossRehearsalCandidate {
  id: string;
  symbol: string;
  exchange: ExchangeId;
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
  funding8h: number;
  expectedNetRate: number;
  entryBasis: number;
  exitBasis?: number;
  spreadCostEstimate: number;
  feeCostEstimate: number;
  depthScore: number;
  liquidityScore: number;
  reason: string;
  warnings: string[];
  purpose: "execution_rehearsal";
  realTradeEligible: false;
  simulationOnly: true;
  chineseMessage: string;
}

export function selectLeastLossRehearsalCandidate(): LeastLossRehearsalCandidate | null {
  const scan = getLatestScan();
  if (!scan?.opportunities?.length) return null;

  const config = getConfig();
  let best: LeastLossRehearsalCandidate | null = null;

  for (const opp of scan.opportunities as OpportunityItem[]) {
    const path = opp.path ?? {};
    const spotEx = String(path.spotExchange ?? opp.spotExchange ?? "");
    const perpEx = String(path.perpExchange ?? opp.perpExchange ?? "");
    const symbol = String(path.symbol ?? opp.symbol ?? "");

    if (spotEx !== perpEx) continue;
    if (spotEx === "htx") continue;
    if (!["binance", "okx"].includes(spotEx)) continue;
    if (isSmallCoin(symbol)) continue;

    const funding8h = Number(opp.funding8h ?? 0);
    const entryBasis = Number(opp.entryExecutableBasis ?? 0);

    const profitInput: NetProfitInput = {
      path: { spotExchange: spotEx as ExchangeId, perpExchange: perpEx as ExchangeId },
      entryBasis, expectedExitBasis: 0.001,
      funding8h, fundingCycles: 1, secondsToNextFunding: 28800,
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate, takerRate: config.takerRate,
      isTakerEntry: false, spotSlippage: 0.001, perpSlippage: 0.0005,
      phase: "tiny",
    };
    const profit = calcNetProfit(profitInput);

    const candidate: LeastLossRehearsalCandidate = {
      id: `rehearsal-${symbol}-${spotEx}-${Date.now()}`,
      symbol, exchange: spotEx as ExchangeId,
      spotExchange: spotEx as ExchangeId, perpExchange: perpEx as ExchangeId,
      funding8h, expectedNetRate: profit.expectedNetRate,
      entryBasis, exitBasis: profit.exitBasisCost,
      spreadCostEstimate: 0.001, feeCostEstimate: profit.feeCost,
      depthScore: Math.min(10, Math.log2(Math.max(1, Number(opp.spotDepth ?? 0) + Number(opp.perpDepth ?? 0)))),
      liquidityScore: Number(opp.score ?? 50),
      reason: opp.passed ? "通过硬过滤" : "亏损最小模拟候选",
      warnings: (opp.warnings as string[] | undefined) ?? [],
      purpose: "execution_rehearsal",
      realTradeEligible: false,
      simulationOnly: true,
      chineseMessage: `[模拟候选] ${symbol} ${spotEx} expectedNetRate=${(profit.expectedNetRate * 100).toFixed(3)}%，仅用于执行链路测试，不允许真实下单。`,
    };

    if (!best || candidate.expectedNetRate > best.expectedNetRate) {
      best = candidate;
    }
  }

  return best;
}
