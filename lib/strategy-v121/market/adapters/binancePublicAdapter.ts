/**
 * Binance Public Adapter — v121 strategy market data
 *
 * Reads Binance spot (api.binance.com) and USD-M futures (fapi.binance.com)
 * public endpoints. No API key required.
 */

import type { IPublicAdapter, RawFundingInfo, RawOrderBook, RawTicker } from "./types";

const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";

export class BinancePublicAdapter implements IPublicAdapter {
  readonly exchangeId = "binance";

  private async fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}: ${url}`);
    return res.json();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchJson(`${FUTURES_BASE}/fapi/v1/ping`);
      return true;
    } catch {
      return false;
    }
  }

  async fetchFundingInfo(symbol: string): Promise<RawFundingInfo> {
    const data = await this.fetchJson(
      `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`
    );
    return {
      fundingRate: Number(data.lastFundingRate ?? 0),
      fundingIntervalHours: 8,
      nextFundingTimeUtc: Number(data.nextFundingTime ?? 0),
      markPrice: Number(data.markPrice ?? 0),
      indexPrice: Number(data.indexPrice ?? 0),
    };
  }

  async fetchTicker(symbol: string): Promise<RawTicker> {
    const data = await this.fetchJson(
      `${FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`
    );
    return {
      symbol: data.symbol,
      lastPrice: Number(data.lastPrice ?? 0),
      bid1: Number(data.bidPrice ?? 0),
      ask1: Number(data.askPrice ?? 0),
      volume24hUsdt: Number(data.quoteVolume ?? 0),
      high: Number(data.highPrice ?? 0),
      low: Number(data.lowPrice ?? 0),
    };
  }

  async fetchTickerSpot(symbol: string): Promise<RawTicker> {
    const data = await this.fetchJson(
      `${SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`
    );
    return {
      symbol: data.symbol,
      lastPrice: Number(data.lastPrice ?? 0),
      bid1: Number(data.bidPrice ?? 0),
      ask1: Number(data.askPrice ?? 0),
      volume24hUsdt: Number(data.quoteVolume ?? 0),
      high: Number(data.highPrice ?? 0),
      low: Number(data.lowPrice ?? 0),
    };
  }

  async fetchOrderBook(symbol: string, depth: number = 20): Promise<RawOrderBook> {
    const data = await this.fetchJson(
      `${FUTURES_BASE}/fapi/v1/depth?symbol=${symbol}&limit=${depth}`
    );
    return {
      bids: (data.bids ?? []).map(([p, q]: string[]) => [Number(p), Number(q)] as [number, number]),
      asks: (data.asks ?? []).map(([p, q]: string[]) => [Number(p), Number(q)] as [number, number]),
      timestamp: Date.now(),
    };
  }

  async fetchOrderBookSpot(symbol: string, depth: number = 20): Promise<RawOrderBook> {
    const data = await this.fetchJson(
      `${SPOT_BASE}/api/v3/depth?symbol=${symbol}&limit=${depth}`
    );
    return {
      bids: (data.bids ?? []).map(([p, q]: string[]) => [Number(p), Number(q)] as [number, number]),
      asks: (data.asks ?? []).map(([p, q]: string[]) => [Number(p), Number(q)] as [number, number]),
      timestamp: Date.now(),
    };
  }

  async getTradingStatus(symbol: string): Promise<"trading" | "halt" | "closed"> {
    try {
      const data = await this.fetchJson(
        `${FUTURES_BASE}/fapi/v1/exchangeInfo`
      );
      const symbols = data.symbols as Array<Record<string, unknown>>;
      const match = symbols.find((s) => s.symbol === symbol);
      if (!match) return "closed";
      return match.status === "TRADING" ? "trading" : "halt";
    } catch {
      return "halt";
    }
  }
}
