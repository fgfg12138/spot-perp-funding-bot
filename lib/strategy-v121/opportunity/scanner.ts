import type { MarketSnapshot, ArbitragePath, OpportunityRecord } from "../domain/types";
import { OPPORTUNITY_WATCHLIST } from "../market/symbolMap";
import { evaluateHardFilters } from "./hardFilters";
import { scoreOpportunity } from "./scoring";
import { calcNetProfit, type NetProfitInput } from "../profitability/netProfit";
import { normalizeFunding8h } from "../market/fundingNormalize";
import { calcEntryExecutableBasis } from "../market/basis";
import type { UserStrategySettings } from "../settings/userStrategySettings";

export interface ScannerInput {
  spotSnapshots: Map<string, MarketSnapshot>;
  perpSnapshots: Map<string, MarketSnapshot>;
  systemHealthy: boolean;
  activeCooldowns: Array<{ pathKey: string; startedAtUtc: number; durationMinutes: number }>;
  plannedNotional: number;
  makerRate: number;
  takerRate: number;
  isTakerEntry: boolean;
  scanMode?: "fixed_universe" | "dynamic_same_exchange";
  settings?: UserStrategySettings;
}

export interface ScannerOutput {
  opportunities: OpportunityRecord[];
  scannedAtUtc: number;
  totalPaths: number;
  passedCount: number;
  rejectedCount: number;
  dataSource: string;
  rejectSummary: Record<string, number>;
}

export function scanOpportunities(input: ScannerInput): ScannerOutput {
  const now = Date.now();
  const opportunities: OpportunityRecord[] = [];
  const rejectSummary: Record<string, number> = {};
  const scanMode = input.scanMode ?? "fixed_universe";
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
      options: input.settings ? {
        minFundingRate8h: input.settings.funding.minFundingRate8h,
        minSpotVolume24hUsdt: input.settings.universe.minSpotVolume24hUsdt,
        minPerpVolume24hUsdt: input.settings.universe.minPerpVolume24hUsdt,
        allowSmallCaps: input.settings.universe.allowSmallCaps,
      } : undefined,
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
    for (const r of record.rejectReasons) {
      rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
    }
  }

  const passed = opportunities.filter(o => o.passed);
  return {
    opportunities,
    scannedAtUtc: now,
    totalPaths: paths.length,
    passedCount: passed.length,
    rejectedCount: opportunities.length - passed.length,
    dataSource: "real_market",
    rejectSummary,
  };
}

/**
 * 基于 OPPORTUNITY_WATCHLIST 生成机会路径（同所 + 跨所）。
 *
 * 同所路径：每个白名单币在支持的交易所上生成同所 spot↔perp 路径。
 * 跨所路径：对于同时在 Binance 和 OKX 的币，生成两个方向：
 *   - Binance spot → OKX perp
 *   - OKX spot → Binance perp
 *
 * scanner 在运行时还会按 snapshot 存在性进一步过滤（某个币在某个所无数据则跳过）。
 */
export function generateAllPaths(): ArbitragePath[] {
  const paths: ArbitragePath[] = [];
  const watchlist = OPPORTUNITY_WATCHLIST;

  // 1. 同所路径 — Binance
  for (const symbol of watchlist) {
    paths.push({ symbol, spotExchange: "binance", perpExchange: "binance", isCrossExchange: false });
  }
  // 2. 同所路径 — OKX
  for (const symbol of watchlist) {
    paths.push({ symbol, spotExchange: "okx", perpExchange: "okx", isCrossExchange: false });
  }
  // 3. 跨所路径 — 对每个白名单币生成两个方向
  for (const symbol of watchlist) {
    paths.push({ symbol, spotExchange: "binance", perpExchange: "okx", isCrossExchange: true });
    paths.push({ symbol, spotExchange: "okx", perpExchange: "binance", isCrossExchange: true });
  }

  return paths;
}
