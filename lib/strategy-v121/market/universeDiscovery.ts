/**
 * 动态发现各交易所内部 spot+perp 同所交集币种。
 *
 * 不再依赖写死的 V121_UNIVERSE，而是实时拉取交易所支持的交易对。
 */
import type { ExchangeId } from "../domain/types";
import { isSmallCoin } from "./contractSpec";

export interface SameExchangeUniverseItem {
  exchange: ExchangeId;
  symbol: string;              // "BTC/USDT"
  spotSymbol: string;
  perpSymbol: string;
  spotSupported: boolean;
  perpSupported: boolean;
  eligibleForScan: boolean;
  eligibleForTiny: boolean;
  reason?: string;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

let lastSuccessfulUniverse: SameExchangeUniverseItem[] | null = null;
let lastSuccessfulAtUtc = 0;
let lastWarnings: string[] = [];
let lastUsedCache = false;

export interface UniverseDiscoveryMeta {
  warnings: string[];
  usedCache: boolean;
  lastSuccessfulAtUtc: number | null;
}

export function getUniverseDiscoveryMeta(): UniverseDiscoveryMeta {
  return {
    warnings: [...lastWarnings],
    usedCache: lastUsedCache,
    lastSuccessfulAtUtc: lastSuccessfulAtUtc > 0 ? lastSuccessfulAtUtc : null,
  };
}

export async function discoverSameExchangeUniverse(options: { ttlMs?: number } = {}): Promise<SameExchangeUniverseItem[]> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  if (lastSuccessfulUniverse && now - lastSuccessfulAtUtc < ttlMs) {
    lastWarnings = [];
    lastUsedCache = true;
    return [...lastSuccessfulUniverse];
  }

  const [binanceResult, okxResult] = await Promise.allSettled([
    discoverBinance(),
    discoverOkx(),
  ]);

  const warnings: string[] = [];
  const failed: string[] = [];

  if (binanceResult.status === "rejected") {
    failed.push(`binance: ${binanceResult.reason?.message ?? String(binanceResult.reason)}`);
  }
  if (okxResult.status === "rejected") {
    failed.push(`okx: ${okxResult.reason?.message ?? String(okxResult.reason)}`);
  }

  if (failed.length > 0) {
    warnings.push(`动态池发现失败: ${failed.join("；")}`);
    if (lastSuccessfulUniverse) {
      warnings.push("动态池发现失败，当前使用上次成功缓存。");
      lastWarnings = warnings;
      lastUsedCache = true;
      return [...lastSuccessfulUniverse];
    }

    lastWarnings = warnings;
    lastUsedCache = false;
    throw new Error(`${warnings.join(" ")} 无可用缓存，本次动态扫描中止。`);
  }

  const binance = binanceResult.status === "fulfilled" ? binanceResult.value : [];
  const okx = okxResult.status === "fulfilled" ? okxResult.value : [];
  const universe = [...binance, ...okx];

  if (universe.length === 0) {
    const message = "动态池发现结果为空，无可用 spot+perp 同所交集。";
    if (lastSuccessfulUniverse) {
      lastWarnings = [message, "当前使用上次成功缓存。"];
      lastUsedCache = true;
      return [...lastSuccessfulUniverse];
    }
    lastWarnings = [message];
    lastUsedCache = false;
    throw new Error(message);
  }

  lastSuccessfulUniverse = universe;
  lastSuccessfulAtUtc = now;
  lastWarnings = [];
  lastUsedCache = false;
  return [...universe];
}

const PRIORITY_COINS = ["BTC","ETH","SOL","XRP","DOGE","BNB","ADA","AVAX","LINK","SUI"];

function sortByPriority(items: unknown[]): string[] {
  const list = items.map(c => c as string);
  const small = new Set(list.filter(c => c.startsWith("1000")));
  return list.sort((a, b) => {
    const pa = PRIORITY_COINS.indexOf(a); const pb = PRIORITY_COINS.indexOf(b);
    if (pa >= 0 && pb >= 0) return pa - pb;
    if (pa >= 0) return -1; if (pb >= 0) return 1;
    const ta = small.has(a) ? 0 : 1; const tb = small.has(b) ? 0 : 1;
    if (ta !== tb) return tb - ta;
    return a.localeCompare(b);
  });
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

async function discoverBinance(): Promise<SameExchangeUniverseItem[]> {
  const [spotData, perpData] = await Promise.all([
    fetchJson("https://api.binance.com/api/v3/exchangeInfo"),
    fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo"),
  ]);

  const spotBases = new Set(
    (spotData.symbols ?? [])
      .filter((s: any) => s.quoteAsset === "USDT" && s.status === "TRADING")
      .map((s: any) => s.baseAsset),
  );
  const perpBases = new Set(
    (perpData.symbols ?? [])
      .filter((s: any) => s.quoteAsset === "USDT" && s.status === "TRADING" && s.contractType === "PERPETUAL")
      .map((s: any) => s.baseAsset),
  );

  const common = sortByPriority([...spotBases].filter(b => perpBases.has(b)));
  return common.map(base => {
    const symbol = `${base}/USDT`;
    const small = isSmallCoin(symbol);
    return {
      exchange: "binance" as ExchangeId, symbol,
      spotSymbol: `${base}USDT`, perpSymbol: `${base}USDT`,
      spotSupported: true, perpSupported: true,
      eligibleForScan: true, eligibleForTiny: !small,
    };
  });
}

async function discoverOkx(): Promise<SameExchangeUniverseItem[]> {
  const [spotData, swapData] = await Promise.all([
    fetchJson("https://www.okx.com/api/v5/public/instruments?instType=SPOT"),
    fetchJson("https://www.okx.com/api/v5/public/instruments?instType=SWAP"),
  ]);

  const spotBases = new Set(
    (spotData.data ?? [])
      .filter((s: any) => s.quoteCcy === "USDT" && s.state === "live")
      .map((s: any) => s.baseCcy),
  );
  const perpBases = new Set(
    (swapData.data ?? [])
      .filter((s: any) => s.quoteCcy === "USDT" && s.state === "live")
      .map((s: any) => s.baseCcy),
  );

  const common = sortByPriority([...spotBases].filter(b => perpBases.has(b)));
  return common.map(base => {
    const symbol = `${base}/USDT`;
    const small = isSmallCoin(symbol);
    return {
      exchange: "okx" as ExchangeId, symbol,
      spotSymbol: `${base}-USDT`, perpSymbol: `${base}-USDT-SWAP`,
      spotSupported: true, perpSupported: true,
      eligibleForScan: true, eligibleForTiny: !small,
    };
  });
}
