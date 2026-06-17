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

export async function discoverSameExchangeUniverse(): Promise<SameExchangeUniverseItem[]> {
  const [binance, okx] = await Promise.all([
    discoverBinance().catch(() => [] as SameExchangeUniverseItem[]),
    discoverOkx().catch(() => [] as SameExchangeUniverseItem[]),
  ]);
  return [...binance, ...okx];
}

async function discoverBinance(): Promise<SameExchangeUniverseItem[]> {
  const [spotData, perpData] = await Promise.all([
    fetch("https://api.binance.com/api/v3/exchangeInfo").then(r => r.json()),
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r => r.json()),
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

  const common = [...spotBases].filter(b => perpBases.has(b)).sort();
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
    fetch("https://www.okx.com/api/v5/public/instruments?instType=SPOT").then(r => r.json()),
    fetch("https://www.okx.com/api/v5/public/instruments?instType=SWAP").then(r => r.json()),
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

  const common = [...spotBases].filter(b => perpBases.has(b)).sort();
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
