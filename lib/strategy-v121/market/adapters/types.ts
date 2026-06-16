import type { MarketSnapshot, OrderBook, OrderBookLevel } from "../../domain/types";

/**
 * Raw funding info from exchange API.
 */
export interface RawFundingInfo {
  fundingRate: number;
  fundingIntervalHours: number;
  nextFundingTimeUtc: number;
  markPrice: number;
  indexPrice: number;
}

/**
 * Raw 24h ticker from exchange API.
 */
export interface RawTicker {
  symbol: string;
  lastPrice: number;
  bid1: number;
  ask1: number;
  volume24hUsdt: number;
  high: number;
  low: number;
}

/**
 * Raw order book from exchange API.
 */
export interface RawOrderBook {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
}

/**
 * Exchange adapter interface for public market data.
 */
export interface IPublicAdapter {
  readonly exchangeId: string;

  /** Fetch funding info (mark, index, funding rate, next settlement) */
  fetchFundingInfo(symbol: string): Promise<RawFundingInfo>;

  /** Fetch 24h ticker (last price, bid1, ask1, volume) */
  fetchTicker(symbol: string): Promise<RawTicker>;

  /** Fetch order book (bids, asks) */
  fetchOrderBook(symbol: string, depth?: number): Promise<RawOrderBook>;

  /** Check if the exchange is healthy (ping) */
  healthCheck(): Promise<boolean>;

  /** Get trading status for a symbol */
  getTradingStatus(symbol: string): Promise<"trading" | "halt" | "closed">;
}

/**
 * Convert raw order book [[price, qty], ...] to OrderBookLevel[].
 */
export function rawLevelsToOrderBook(raw: Array<[number, number]>): OrderBookLevel[] {
  return raw.map(([price, qty]) => ({ price, qty }));
}

/**
 * Build a v121 MarketSnapshot from adapter raw data.
 */
export function buildMarketSnapshot(
  exchangeId: string,
  canonicalSymbol: string,
  marketType: "spot" | "perp",
  ticker: RawTicker,
  orderBook: RawOrderBook,
  funding?: RawFundingInfo,
  contractSpec?: any
): MarketSnapshot {
  const mid = (ticker.bid1 + ticker.ask1) / 2;
  const spreadRate = mid > 0 ? (ticker.ask1 - ticker.bid1) / mid : 0;

  const ob: OrderBook = {
    bids: rawLevelsToOrderBook(orderBook.bids),
    asks: rawLevelsToOrderBook(orderBook.asks),
    timestampUtc: orderBook.timestamp,
  };

  return {
    exchangeId: exchangeId as MarketSnapshot["exchangeId"],
    symbol: canonicalSymbol,
    marketType: marketType as MarketSnapshot["marketType"],
    bid1: ticker.bid1,
    ask1: ticker.ask1,
    mid,
    markPrice: funding?.markPrice,
    indexPrice: funding?.indexPrice,
    fundingRate: funding?.fundingRate,
    fundingIntervalHours: funding?.fundingIntervalHours,
    nextFundingTimeUtc: funding?.nextFundingTimeUtc,
    volume24hUsdt: ticker.volume24hUsdt,
    orderBook: ob,
    spreadRate,
    timestampUtc: Date.now(),
    localReceiveTimeUtc: Date.now(),
    tradingStatus: "trading",
    contractSpec,
  };
}
