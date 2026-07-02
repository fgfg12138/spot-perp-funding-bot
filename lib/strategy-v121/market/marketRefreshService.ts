import type { ExchangeId, MarketSnapshot } from "../domain/types";
import { discoverSameExchangeUniverse, getUniverseDiscoveryMeta } from "./universeDiscovery";
import { BinancePublicAdapter } from "./adapters/binancePublicAdapter";
import { OkxPublicAdapter } from "./adapters/okxPublicAdapter";
import { buildMarketSnapshot } from "./adapters/types";
import { scanOpportunities } from "../opportunity/scanner";
import { saveLatestScan } from "../opportunity/opportunityStore";
import { getRepository } from "../persistence/repositoryFactory";


function repo() { return getRepository(); }

interface UnifiedAdapter {
  exchangeId: ExchangeId;
  fetchTicker(symbol: string): Promise<any>;
  fetchOrderBook(symbol: string, depth?: number): Promise<any>;
  fetchFundingInfo?(symbol: string): Promise<any>;
  fetchTickerSpot(symbol: string): Promise<any>;
  fetchOrderBookSpot(symbol: string, depth?: number): Promise<any>;
}

function getAdapter(exchangeId: ExchangeId): UnifiedAdapter {
  switch (exchangeId) {
    case "binance": return new BinancePublicAdapter() as UnifiedAdapter;
    case "okx":     return new OkxPublicAdapter() as UnifiedAdapter;
    default:
      throw new Error(`Unsupported exchange: ${exchangeId}`);
  }
}

export type MarketScanMode = "fixed_universe" | "dynamic_same_exchange";

export interface MarketRefreshResult {
  spotSnapshots: Map<string, MarketSnapshot>;
  perpSnapshots: Map<string, MarketSnapshot>;
  errors: { exchange: ExchangeId; symbol: string; error: string }[];
  scanResult?: ReturnType<typeof scanOpportunities>;
  refreshedAtUtc: number;
  scanMode: MarketScanMode;
  dataSource: string;
  dynamicUniverseCount: number;
  dynamicUniverseByExchange: Partial<Record<ExchangeId, number>>;
  dynamicUniverseWarnings: string[];
}

export async function refreshAndScan(input: {
  plannedNotional?: number;
  makerRate: number; takerRate: number;
  isTakerEntry: boolean; systemHealthy: boolean;
  symbols?: string[];
  maxDynamicSymbolsPerExchange?: number;
}): Promise<MarketRefreshResult> {
  const now = Date.now();
  const { loadSettings } = await import("../settings/userStrategySettingsStore");
  const settings = await loadSettings();

  const plannedNotional = input.plannedNotional ?? settings.notional.plannedNotionalUsdt;
  const spotMap = new Map<string, MarketSnapshot>();
  const perpMap = new Map<string, MarketSnapshot>();
  const errors: MarketRefreshResult["errors"] = [];
  let dynamicCount = 0;
  const dynamicByExchange: Partial<Record<ExchangeId, number>> = {};
  let dynamicWarnings: string[] = [];
  const scanMode: MarketScanMode = "dynamic_same_exchange";

  // 动态监控池：从交易所发现所有可用的 spot+perp 同所币种，每所上限 1000
  const dynamic = await discoverSameExchangeUniverse();
  const meta = getUniverseDiscoveryMeta();
  dynamicWarnings = meta.warnings;

  const priority = settings.universe.prioritySymbols;
  const priorityRank = (symbol: string) => {
    const idx = priority.indexOf(symbol);
    return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
  };
  const eligible = dynamic
    .filter(d => d.eligibleForScan)
    .filter(d => settings.universe.symbolWhitelist.length === 0 || settings.universe.symbolWhitelist.includes(d.symbol))
    .filter(d => !settings.universe.symbolBlacklist.includes(d.symbol))
    .sort((a, b) => priorityRank(a.symbol) - priorityRank(b.symbol) || Number(b.eligibleForTiny) - Number(a.eligibleForTiny) || a.symbol.localeCompare(b.symbol));
  const maxPerEx = input.maxDynamicSymbolsPerExchange ?? settings.universe.maxDynamicSymbolsPerExchange;
  dynamicCount = eligible.length;

  for (const item of eligible) {
    dynamicByExchange[item.exchange] = (dynamicByExchange[item.exchange] ?? 0) + 1;
  }

  for (const ex of ["binance", "okx"] as ExchangeId[]) {
    const items = eligible.filter(i => i.exchange === ex).slice(0, maxPerEx);
    const adapter = getAdapter(ex);
    const tasks = items.map(async (item) => {
      try {
        // ★ 现货必须调用现货专用 endpoint，否则基差计算会拿两个永续价格相减
        const ticker = await adapter.fetchTickerSpot(item.spotSymbol);
        const ob = await adapter.fetchOrderBookSpot(item.spotSymbol, 10);
        const snap = buildMarketSnapshot(ex, item.symbol, "spot", ticker, ob);
        spotMap.set(`${ex}:${item.symbol}`, snap);
      } catch (err: any) {
        errors.push({ exchange: ex, symbol: item.symbol, error: err.message });
      }
      try {
        const ticker = await adapter.fetchTicker(item.perpSymbol);
        const ob = await adapter.fetchOrderBook(item.perpSymbol, 10);
        let funding;
        try { funding = await adapter.fetchFundingInfo?.(item.perpSymbol); } catch (e) { console.error({ err: e, exchange: ex, symbol: item.symbol }, "fetchFundingInfo failed, using undefined"); }
        const snap = buildMarketSnapshot(ex, item.symbol, "perp", ticker, ob, funding);
        perpMap.set(`${ex}:${item.symbol}`, snap);
      } catch (err: any) {
        errors.push({ exchange: ex, symbol: item.symbol, error: err.message });
      }
    });
    await Promise.all(tasks);
  }

  const scanResult = scanOpportunities({
    spotSnapshots: spotMap, perpSnapshots: perpMap,
    systemHealthy: input.systemHealthy, activeCooldowns: [],
    plannedNotional,
    makerRate: input.makerRate, takerRate: input.takerRate,
    isTakerEntry: input.isTakerEntry, scanMode,
    settings,
  });

  // Persist
  for (const opp of scanResult.opportunities) {
    repo().save("opportunity_records", {
      id: opp.id, discovered_at_utc: opp.discoveredAtUtc,
      discovered_at_utc8: new Date(opp.discoveredAtUtc).toISOString(),
      symbol: opp.path?.symbol ?? "", spot_exchange: opp.path?.spotExchange ?? "",
      perp_exchange: opp.path?.perpExchange ?? "",
      funding_8h: opp.funding8h, entry_basis: opp.entryExecutableBasis,
      exit_basis: opp.riskMarkBasis, spot_depth: opp.spotDepth, perp_depth: opp.perpDepth,
      score: opp.score, level: opp.level, passed: opp.passed ? 1 : 0,
      reject_reason: JSON.stringify(opp.rejectReasons),
      raw_snapshot_json: JSON.stringify({ dataSource: scanResult.dataSource, scannedAtUtc: now, scanMode }),
    } as any);
  }

  const rejectSummary: Record<string, number> = scanResult.rejectSummary ?? {};
  saveLatestScan({
    opportunities: scanResult.opportunities, totalPaths: scanResult.totalPaths,
    passedCount: scanResult.passedCount, rejectedCount: scanResult.rejectedCount,
    rejectSummary, errors: errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
    dataSource: scanResult.dataSource, scannedAtUtc: scanResult.scannedAtUtc,
    durationMs: Date.now() - now, symbolsScanned: dynamicCount,
    exchangesScanned: Object.keys(dynamicByExchange).length,
  });

  return {
    spotSnapshots: spotMap,
    perpSnapshots: perpMap,
    errors,
    scanResult,
    refreshedAtUtc: now,
    scanMode,
    dataSource: scanResult.dataSource,
    dynamicUniverseCount: dynamicCount,
    dynamicUniverseByExchange: dynamicByExchange,
    dynamicUniverseWarnings: dynamicWarnings,
  };
}
