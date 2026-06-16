import type { ExchangeId, MarketSnapshot, ArbitragePath, OpportunityRecord } from "../domain/types";
import { V121_UNIVERSE } from "../market/symbolMap";
import { evaluateHardFilters } from "./hardFilters";
import { scoreOpportunity } from "./scoring";
import { calcNetProfit, type NetProfitInput } from "../profitability/netProfit";
import { normalizeFunding8h } from "../market/fundingNormalize";
import { calcEntryExecutableBasis } from "../market/basis";

export interface ScannerInput {
  spotSnapshots: Map<string, MarketSnapshot>;
  perpSnapshots: Map<string, MarketSnapshot>;
  systemHealthy: boolean;
  activeCooldowns: Array<{ pathKey: string; startedAtUtc: number; durationMinutes: number }>;
  plannedNotional: number;
  makerRate: number;
  takerRate: number;
  isTakerEntry: boolean;
}

export interface ScannerOutput {
  opportunities: OpportunityRecord[];
  scannedAtUtc: number;
  totalPaths: number;
  passedCount: number;
}

export function scanOpportunities(input: ScannerInput): ScannerOutput {
  const now = Date.now();
  const opportunities: OpportunityRecord[] = [];
  const paths = generateAllPaths();

  for (const path of paths) {
    const spotKey = `${path.spotExchange}:${path.symbol}`;
    const perpKey = `${path.perpExchange}:${path.symbol}`;
    const spotSnap = input.spotSnapshots.get(spotKey);
    const perpSnap = input.perpSnapshots.get(perpKey);
    if (!spotSnap || !perpSnap) continue;

    const fundingRate = perpSnap.fundingRate ?? 0;
    const interval = perpSnap.fundingIntervalHours ?? 8;
    const funding8h = normalizeFunding8h(fundingRate, interval);
    const entryBasis = calcEntryExecutableBasis(perpSnap.bid1, spotSnap.ask1);

    const pathKey = `${path.spotExchange}:${path.perpExchange}:${path.symbol}`;
    const cooldown = input.activeCooldowns.find(cd => cd.pathKey === pathKey);
    const isInCooldown = cooldown
      ? (now - cooldown.startedAtUtc) / 60000 < cooldown.durationMinutes
      : false;

    const filterResult = evaluateHardFilters({
      path: { spotExchange: path.spotExchange, perpExchange: path.perpExchange, symbol: path.symbol },
      spotSnapshot: spotSnap, perpSnapshot: perpSnap,
      funding8h, plannedNotional: input.plannedNotional,
      isInCooldown, systemHealthy: input.systemHealthy,
      listedHoursAgo: 720, perpCanOpen: true,
    });

    const scoringResult = scoreOpportunity({
      path: { spotExchange: path.spotExchange, perpExchange: path.perpExchange },
      spotSnapshot: spotSnap, perpSnapshot: perpSnap,
      funding8h, entryExecutableBasis: entryBasis,
    });

    const secondsToFunding = perpSnap.nextFundingTimeUtc
      ? Math.max(0, perpSnap.nextFundingTimeUtc - now) / 1000
      : 28800;

    const profitInput: NetProfitInput = {
      path: { spotExchange: path.spotExchange, perpExchange: path.perpExchange },
      entryBasis, expectedExitBasis: 0.001,
      funding8h, fundingCycles: 1,
      secondsToNextFunding: secondsToFunding,
      plannedNotional: input.plannedNotional,
      makerRate: input.makerRate, takerRate: input.takerRate,
      isTakerEntry: input.isTakerEntry,
      spotSlippage: spotSnap.spreadRate * 0.5,
      perpSlippage: perpSnap.spreadRate * 0.5,
      phase: "tiny",
    };
    const profitResult = calcNetProfit(profitInput);

    const spotDepth = spotSnap.orderBook
      ? spotSnap.orderBook.asks.slice(0, 5).reduce((s, l) => s + l.price * l.qty, 0)
      : 0;
    const perpDepth = perpSnap.orderBook
      ? perpSnap.orderBook.bids.slice(0, 5).reduce((s, l) => s + l.price * l.qty, 0)
      : 0;

    const record: OpportunityRecord = {
      id: `${pathKey}-${now}`,
      path,
      discoveredAtUtc: now,
      funding8h,
      entryExecutableBasis: entryBasis,
      riskMarkBasis: (perpSnap.markPrice && spotSnap.mid > 0)
        ? perpSnap.markPrice / spotSnap.mid - 1 : 0,
      spotDepth, perpDepth,
      score: scoringResult.score,
      level: scoringResult.level,
      passed: filterResult.passed && profitResult.passed,
      rejectReasons: filterResult.rejectReasons,
      warnings: [...filterResult.warnings, ...scoringResult.warnings],
      nextAction: filterResult.nextAction,
    };
    opportunities.push(record);
  }

  const passed = opportunities.filter(o => o.passed);
  return {
    opportunities,
    scannedAtUtc: now,
    totalPaths: paths.length,
    passedCount: passed.length,
  };
}

export function generateAllPaths(): ArbitragePath[] {
  const exchanges: ExchangeId[] = ["binance", "okx", "htx"];
  const paths: ArbitragePath[] = [];
  for (const symbol of V121_UNIVERSE) {
    for (const spot of exchanges) {
      for (const perp of exchanges) {
        paths.push({
          symbol, spotExchange: spot, perpExchange: perp,
          isCrossExchange: spot !== perp,
        });
      }
    }
  }
  return paths;
}
