/**
 * 市场行情刷新服务 — 遍历 universe → 调用 adapter → 构建 MarketSnapshot → 扫描 → 持久化。
 *
 * 不下单，不改账户，只读。在 READ_ONLY / PAPER / SHADOW 下均可安全运行。
 */
import type { ExchangeId, MarketSnapshot } from "../domain/types";
import { V121_UNIVERSE, canonicalToExchange } from "./symbolMap";
import { BinancePublicAdapter } from "./adapters/binancePublicAdapter";
import { OkxPublicAdapter } from "./adapters/okxPublicAdapter";
import { HtxPublicAdapter } from "./adapters/htxPublicAdapter";
import { buildMarketSnapshot } from "./adapters/types";
import { scanOpportunities } from "../opportunity/scanner";
import { saveLatestScan } from "../opportunity/opportunityStore";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

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
}): Promise<MarketRefreshResult> {
  const now = Date.now();
  const symbols = input.symbols ?? V121_UNIVERSE;
  const exchanges: ExchangeId[] = ["binance", "okx", "htx"];
  const errors: MarketRefreshResult["errors"] = [];
  const spotMap = new Map<string, MarketSnapshot>();
  const perpMap = new Map<string, MarketSnapshot>();

  const safeFetch = async (
    ex: ExchangeId, adapter: UnifiedAdapter, rawSym: string,
    canonical: string, marketType: "spot" | "perp",
  ) => {
    try {
      const ticker = await adapter.fetchTicker(rawSym);
      const ob = await adapter.fetchOrderBook(rawSym, 10);
      let funding;
      if (marketType === "perp" && adapter.fetchFundingInfo) {
        try { funding = await adapter.fetchFundingInfo(rawSym); } catch { /* optional */ }
      }
      const snap = buildMarketSnapshot(ex, canonical, marketType, ticker, ob, funding ?? undefined);
      const key = `${ex}:${canonical}`;
      if (marketType === "spot") spotMap.set(key, snap);
      else perpMap.set(key, snap);
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

  // 持久化
  for (const opp of scanResult.opportunities) {
    repo.save("opportunity_records", {
      ...opp,
      dataSource: "real_market",
      scannedAtUtc: now,
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
