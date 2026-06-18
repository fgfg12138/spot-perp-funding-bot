import type { ExchangeId, MarketSnapshot } from "../domain/types";
import { V121_UNIVERSE, canonicalToExchange } from "./symbolMap";
import { discoverSameExchangeUniverse, getUniverseDiscoveryMeta } from "./universeDiscovery";
import { BinancePublicAdapter } from "./adapters/binancePublicAdapter";
import { OkxPublicAdapter } from "./adapters/okxPublicAdapter";
import { HtxPublicAdapter } from "./adapters/htxPublicAdapter";
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
}

function getAdapter(exchangeId: ExchangeId): UnifiedAdapter {
  switch (exchangeId) {
    case "binance": return new BinancePublicAdapter() as any;
    case "okx":     return new OkxPublicAdapter() as any;
    case "htx":     return new HtxPublicAdapter() as any;
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
  plannedNotional: number;
  makerRate: number; takerRate: number;
  isTakerEntry: boolean; systemHealthy: boolean;
  symbols?: string[];
  useDynamicUniverse?: boolean;
  scanMode?: MarketScanMode;
  maxDynamicSymbolsPerExchange?: number;
}): Promise<MarketRefreshResult> {
  const now = Date.now();
  const spotMap = new Map<string, MarketSnapshot>();
  const perpMap = new Map<string, MarketSnapshot>();
  const errors: MarketRefreshResult["errors"] = [];
  let dynamicCount = 0;
  const dynamicByExchange: Partial<Record<ExchangeId, number>> = {};
  let dynamicWarnings: string[] = [];
  const scanMode: MarketScanMode = input.useDynamicUniverse
    ? "dynamic_same_exchange"
    : (input.scanMode ?? "fixed_universe");

  // Dynamic same-exchange scan
  if (input.useDynamicUniverse) {
    const dynamic = await discoverSameExchangeUniverse();
    const meta = getUniverseDiscoveryMeta();
    dynamicWarnings = meta.warnings;

    const eligible = dynamic.filter(d => d.eligibleForScan);
    const maxPerEx = input.maxDynamicSymbolsPerExchange ?? 50;
    dynamicCount = eligible.length;

    for (const item of eligible) {
      dynamicByExchange[item.exchange] = (dynamicByExchange[item.exchange] ?? 0) + 1;
    }

    for (const ex of ["binance", "okx"] as ExchangeId[]) {
      const items = eligible.filter(i => i.exchange === ex).slice(0, maxPerEx);
      const adapter = getAdapter(ex);
      const tasks = items.map(async (item) => {
        try {
          const ticker = await adapter.fetchTicker(item.spotSymbol);
          const ob = await adapter.fetchOrderBook(item.spotSymbol, 10);
          const snap = buildMarketSnapshot(ex, item.symbol, "spot", ticker, ob);
          spotMap.set(`${ex}:${item.symbol}`, snap);
        } catch (err: any) {
          errors.push({ exchange: ex, symbol: item.symbol, error: err.message });
        }
        try {
          const ticker = await adapter.fetchTicker(item.perpSymbol);
          const ob = await adapter.fetchOrderBook(item.perpSymbol, 10);
          let funding;
          try { funding = await adapter.fetchFundingInfo?.(item.perpSymbol); } catch {}
          const snap = buildMarketSnapshot(ex, item.symbol, "perp", ticker, ob, funding);
          perpMap.set(`${ex}:${item.symbol}`, snap);
        } catch (err: any) {
          errors.push({ exchange: ex, symbol: item.symbol, error: err.message });
        }
      });
      await Promise.all(tasks);
    }
  } else {
    // Fixed universe scan
    const symbols = input.symbols !== undefined && input.symbols !== null
      ? input.symbols : V121_UNIVERSE;
    const exchanges: ExchangeId[] = ["binance", "okx", "htx"];

    for (const canonical of symbols) {
      for (const ex of exchanges) {
        const adapter = getAdapter(ex);
        const spotSym = canonicalToExchange(canonical, ex, "spot");
        const perpSym = canonicalToExchange(canonical, ex, "perp");
        try {
          const ticker = await adapter.fetchTicker(spotSym);
          const ob = await adapter.fetchOrderBook(spotSym, 10);
          spotMap.set(`${ex}:${canonical}`, buildMarketSnapshot(ex, canonical, "spot", ticker, ob));
        } catch (err: any) { errors.push({ exchange: ex, symbol: canonical, error: err.message }); }
        try {
          if (ex === "htx") {
            const htxTicker = await (adapter as any).fetchTickerSwap(perpSym);
            const htxOb = await (adapter as any).fetchOrderBookSwap(perpSym, 10);
            perpMap.set(`${ex}:${canonical}`, buildMarketSnapshot(ex, canonical, "perp", htxTicker, htxOb));
          } else {
            const ticker = await adapter.fetchTicker(perpSym);
            const ob = await adapter.fetchOrderBook(perpSym, 10);
            let funding;
            try { funding = await adapter.fetchFundingInfo?.(perpSym); } catch {}
            perpMap.set(`${ex}:${canonical}`, buildMarketSnapshot(ex, canonical, "perp", ticker, ob, funding));
          }
        } catch (err: any) { errors.push({ exchange: ex, symbol: canonical, error: err.message }); }
      }
    }
  }

  const scanResult = scanOpportunities({
    spotSnapshots: spotMap, perpSnapshots: perpMap,
    systemHealthy: input.systemHealthy, activeCooldowns: [],
    plannedNotional: input.plannedNotional,
    makerRate: input.makerRate, takerRate: input.takerRate,
    isTakerEntry: input.isTakerEntry, scanMode,
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
    durationMs: Date.now() - now, symbolsScanned: dynamicCount || (input.symbols?.length ?? V121_UNIVERSE.length),
    exchangesScanned: input.useDynamicUniverse ? Object.keys(dynamicByExchange).length : 3,
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
