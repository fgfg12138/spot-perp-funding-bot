/**
 * HTX Public Adapter — v121 strategy market data
 *
 * Reads HTX spot and swap public endpoints. No API key required.
 */

import type { IPublicAdapter, RawFundingInfo, RawOrderBook, RawTicker } from "./types";

const BASE_URL = "https://api.huobi.pro";

export class HtxPublicAdapter implements IPublicAdapter {
  readonly exchangeId = "htx";

  private async fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTX HTTP ${res.status}: ${url}`);
    const wrapper = await res.json();
    if (wrapper.status !== "ok") throw new Error(`HTX API error: ${wrapper["err-msg"] ?? "unknown"}`);
    return wrapper;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchJson(`${BASE_URL}/v2/status`);
      return true;
    } catch {
      return false;
    }
  }

  async fetchFundingInfo(symbol: string): Promise<RawFundingInfo> {
    // HTX symbol for swap: "BTC-USDT"
    const data = await this.fetchJson(
      `${BASE_URL}/linear-swap-api/v1/swap_funding_rate?contract_code=${symbol}`
    );
    const item = data.data as Record<string, unknown>;
    return {
      fundingRate: Number(item?.funding_rate ?? 0),
      fundingIntervalHours: 8,
      nextFundingTimeUtc: Number(item?.next_funding_time ?? 0) * 1000,
      markPrice: 0, // HTX funding endpoint doesn't always include mark; use ticker
      indexPrice: 0,
    };
  }

  async fetchTicker(symbol: string): Promise<RawTicker> {
    const data = await this.fetchJson(
      `${BASE_URL}/market/detail/merged?symbol=${symbol.toLowerCase()}`
    );
    const tick = data.tick as Record<string, unknown>;
    return {
      symbol: symbol,
      lastPrice: Number(tick?.close ?? 0),
      bid1: Number((tick?.bid as any[])?.[0] ?? 0),
      ask1: Number((tick?.ask as any[])?.[0] ?? 0),
      volume24hUsdt: Number(tick?.vol ?? 0),
      high: Number(tick?.high ?? 0),
      low: Number(tick?.low ?? 0),
    };
  }

  async fetchOrderBook(symbol: string, depth: number = 20): Promise<RawOrderBook> {
    const data = await this.fetchJson(
      `${BASE_URL}/market/depth?symbol=${symbol.toLowerCase()}&type=step0&depth=${depth}`
    );
    const tick = data.tick as Record<string, unknown>;
    return {
      bids: (tick?.bids as any[] ?? []).map(([p, q]: number[]) => [p, q] as [number, number]),
      asks: (tick?.asks as any[] ?? []).map(([p, q]: number[]) => [p, q] as [number, number]),
      timestamp: Date.now(),
    };
  }

  async getTradingStatus(symbol: string): Promise<"trading" | "halt" | "closed"> {
    try {
      await this.fetchTicker(symbol);
      return "trading";
    } catch {
      return "halt";
    }
  }
}
