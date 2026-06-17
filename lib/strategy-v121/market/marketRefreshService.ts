/**
 * 市场行情刷新服务 — 遍历 universe → 调用 adapter → 构建 MarketSnapshot → 扫描 → 持久化。
 *
 * 不下单，不改账户，只读。在 READ_ONLY / PAPER / SHADOW 下均可安全运行。
 */
import type { ExchangeId, MarketSnapshot } from "../domain/types";
import { V121_UNIVERSE, CONSERVATIVE_UNIVERSE, canonicalToExchange } from "./symbolMap";
import { discoverSameExchangeUniverse } from "./universeDiscovery";
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

export interface MarketRefreshResult {
  spotSnapshots: Map<string, MarketSnapshot>;
  perpSnapshots: Map<string, MarketSnapshot>;
  errors: { exchange: ExchangeId; symbol: string; error: string }[];
  scanResult?: ReturnType<typeof scanOpportunities>;
  refreshedAtUtc: number;
}

export async function refreshAndScan(input: {
  plannedNotional: number;
  makerRate: number;
  takerRate: number;
  isTakerEntry: boolean;
  systemHealthy: boolean;
  symbols?: string[];
  useDynamicUniverse?: boolean;
}): Promise<MarketRefreshResult> {
  const now = Date.now();
  const rawSymbols = input.symbols;
  let symbols: string[];
  if (rawSymbols !== undefined && rawSymbols !== null) {
    symbols = rawSymbols;
  } else if (input.useDynamicUniverse) {
    const dynamic = await discoverSameExchangeUniverse();
    symbols = [...new Set(dynamic.filter(d => d.eligibleForScan).map(d => d.symbol))];
  } else {
    symbols = V121_UNIVERSE;
  }
  const exchanges: ExchangeId[] = ["binance", "okx", "htx"];
  const errors: MarketRefreshResult["errors"] = [];
  const spotMap = new Map<string, MarketSnapshot>();
  const perpMap = new Map<string, MarketSnapshot>();

  const safeFetch = async (
    ex: ExchangeId, adapter: UnifiedAdapter, rawSym: string,
    canonical: string, marketType: "spot" | "perp",
  ) => {
    try {
      if (marketType === "perp" && ex === "htx") {
        // HTX perp uses swap endpoints
        const htxTicker = await (adapter as any).fetchTickerSwap(rawSym);
        const htxOb = await (adapter as any).fetchOrderBookSwap(rawSym, 10);
        let htxFunding;
        try { htxFunding = await (adapter as any).fetchFundingInfo(rawSym); } catch { /* optional */ }
        const snap = buildMarketSnapshot(ex, canonical, "perp", htxTicker, htxOb, htxFunding ?? undefined);
        perpMap.set(`${ex}:${canonical}`, snap);
        return;
      }

      // Standard path
      const ticker = await adapter.fetchTicker(rawSym);
      const ob = await adapter.fetchOrderBook(rawSym, 10);
      let funding;
      if (marketType === "perp" && adapter.fetchFundingInfo) {
        try { funding = await adapter.fetchFundingInfo(rawSym); } catch { /* optional */ }
      }
      const snap = buildMarketSnapshot(ex, canonical, marketType, ticker, ob, funding ?? undefined);
      if (marketType === "spot") spotMap.set(`${ex}:${canonical}`, snap);
      else perpMap.set(`${ex}:${canonical}`, snap);
    } catch (err) {
      errors.push({ exchange: ex, symbol: canonical, error: (err as Error).message });
    }
  };

  for (const canonical of symbols) {
    const tasks: Promise<void>[] = [];
    for (const ex of exchanges) {
      const adapter = getAdapter(ex);
      const spotSym = canonicalToExchange(canonical, ex, "spot");
      const perpSym = canonicalToExchange(canonical, ex, "perp");
      tasks.push(safeFetch(ex, adapter, spotSym, canonical, "spot"));
      tasks.push(safeFetch(ex, adapter, perpSym, canonical, "perp"));
    }
    await Promise.all(tasks);
  }

  const scanResult = scanOpportunities({
    spotSnapshots: spotMap,
    perpSnapshots: perpMap,
    systemHealthy: input.systemHealthy,
    activeCooldowns: [],
    plannedNotional: input.plannedNotional,
    makerRate: input.makerRate,
    takerRate: input.takerRate,
    isTakerEntry: input.isTakerEntry,
  });

  // 持久化 — 展开 OpportunityRecord 为 SQLite 平面列
  for (const opp of scanResult.opportunities) {
    repo().save("opportunity_records", {
      id: opp.id,
      discovered_at_utc: opp.discoveredAtUtc,
      discovered_at_utc8: new Date(opp.discoveredAtUtc).toISOString(),
      symbol: opp.path?.symbol ?? "",
      spot_exchange: opp.path?.spotExchange ?? "",
      perp_exchange: opp.path?.perpExchange ?? "",
      funding_8h: opp.funding8h,
      entry_basis: opp.entryExecutableBasis,
      exit_basis: opp.riskMarkBasis,
      spot_depth: opp.spotDepth,
      perp_depth: opp.perpDepth,
      score: opp.score,
      level: opp.level,
      passed: opp.passed ? 1 : 0,
      reject_reason: JSON.stringify(opp.rejectReasons),
      raw_snapshot_json: JSON.stringify({
        warnings: opp.warnings,
        nextAction: opp.nextAction,
        dataSource: "real_market",
        scannedAtUtc: now,
      }),
    } as any);
  }

  // 缓存最新扫描结果
  const scanRejectSummary: Record<string, number> = {};
  for (const opp of scanResult.opportunities) {
    for (const r of opp.rejectReasons) {
      scanRejectSummary[r.rule] = (scanRejectSummary[r.rule] ?? 0) + 1;
    }
  }
  saveLatestScan({
    opportunities: scanResult.opportunities,
    totalPaths: scanResult.totalPaths,
    passedCount: scanResult.passedCount,
    rejectedCount: scanResult.rejectedCount,
    rejectSummary: scanRejectSummary,
    errors: errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
    dataSource: "real_market",
    scannedAtUtc: scanResult.scannedAtUtc,
    durationMs: Date.now() - now,
    symbolsScanned: symbols.length,
    exchangesScanned: exchanges.length,
  });

  return {
    spotSnapshots: spotMap, perpSnapshots: perpMap,
    errors, scanResult, refreshedAtUtc: now,
  };
}
