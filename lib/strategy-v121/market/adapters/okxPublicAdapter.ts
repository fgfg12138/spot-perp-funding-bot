/**
 * OKX Public Adapter — v121 strategy market data
 *
 * Reads OKX spot and swap public endpoints. No API key required.
 */

import type { IPublicAdapter, RawFundingInfo, RawOrderBook, RawTicker } from "./types";

const BASE_URL = "https://www.okx.com";

export class OkxPublicAdapter implements IPublicAdapter {
  readonly exchangeId = "okx";

  private async fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}: ${url}`);
    const wrapper = await res.json();
    if (wrapper.code !== "0") throw new Error(`OKX API error: ${wrapper.msg}`);
    return wrapper.data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchJson(`${BASE_URL}/api/v5/public/time`);
      return true;
    } catch {
      return false;
    }
  }

  async fetchFundingInfo(symbol: string): Promise<RawFundingInfo> {
    // symbol format: "BTC-USDT-SWAP"
    const data = await this.fetchJson(
      `${BASE_URL}/api/v5/public/funding-rate?instId=${symbol}`
    );
    const item = Array.isArray(data) ? data[0] : data;
    return {
      fundingRate: Number(item?.fundingRate ?? 0),
      fundingIntervalHours: 8,
      nextFundingTimeUtc: Number(item?.nextFundingTime ?? 0),
      markPrice: Number(item?.markPrice ?? 0),
      indexPrice: 0, // OKX funding-rate endpoint doesn't include index price
    };
  }

  async fetchTicker(symbol: string): Promise<RawTicker> {
    const data = await this.fetchJson(
      `${BASE_URL}/api/v5/market/ticker?instId=${symbol}`
    );
    const item = Array.isArray(data) ? data[0] : data;
    return {
      symbol: item?.instId ?? symbol,
      lastPrice: Number(item?.last ?? 0),
      bid1: Number(item?.bidPx ?? 0),
      ask1: Number(item?.askPx ?? 0),
      volume24hUsdt: Number(item?.volCcy24h ?? 0),
      high: Number(item?.high24h ?? 0),
      low: Number(item?.low24h ?? 0),
    };
  }

  /** 现货 ticker（与 fetchTicker 共用同一 endpoint，但传入的 symbol 不加 -SWAP） */
  async fetchTickerSpot(symbol: string): Promise<RawTicker> {
    const data = await this.fetchJson(
      `${BASE_URL}/api/v5/market/ticker?instId=${symbol}`
    );
    const item = Array.isArray(data) ? data[0] : data;
    return {
      symbol: item?.instId ?? symbol,
      lastPrice: Number(item?.last ?? 0),
      bid1: Number(item?.bidPx ?? 0),
      ask1: Number(item?.askPx ?? 0),
      volume24hUsdt: Number(item?.volCcy24h ?? 0),
      high: Number(item?.high24h ?? 0),
      low: Number(item?.low24h ?? 0),
    };
  }

  async fetchOrderBook(symbol: string, depth: number = 20): Promise<RawOrderBook> {
    const data = await this.fetchJson(
      `${BASE_URL}/api/v5/market/books?instId=${symbol}&sz=${depth}`
    );
    const item = Array.isArray(data) ? data[0] : data;
    return {
      bids: (item?.bids ?? []).map(([p, q, _lq, _n]: string[]) => [Number(p), Number(q)] as [number, number]),
      asks: (item?.asks ?? []).map(([p, q, _lq, _n]: string[]) => [Number(p), Number(q)] as [number, number]),
      timestamp: Number(item?.ts ?? Date.now()),
    };
  }

  /** Fetch spot order book (alias for fetchOrderBook for UnifiedAdapter compatibility) */
  async fetchOrderBookSpot(symbol: string, depth: number = 20): Promise<RawOrderBook> {
    return this.fetchOrderBook(symbol, depth);
  }

  async getTradingStatus(symbol: string): Promise<"trading" | "halt" | "closed"> {
    try {
      const data = await this.fetchJson(
        `${BASE_URL}/api/v5/public/instruments?instType=SWAP&instId=${symbol}`
      );
      const item = Array.isArray(data) ? data[0] : data;
      if (!item) return "closed";
      return item.state === "live" ? "trading" : "halt";
    } catch {
      return "halt";
    }
  }
}
