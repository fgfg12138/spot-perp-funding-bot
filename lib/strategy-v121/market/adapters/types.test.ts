import { describe, expect, it } from "vitest";
import { buildMarketSnapshot, rawLevelsToOrderBook } from "./types";
import type { RawTicker, RawOrderBook, RawFundingInfo } from "./types";

describe("buildMarketSnapshot", () => {
  const ticker: RawTicker = {
    symbol: "BTCUSDT", lastPrice: 65000, bid1: 64990, ask1: 65010,
    volume24hUsdt: 1_000_000_000, high: 65100, low: 64800,
  };
  const ob: RawOrderBook = {
    bids: [[64990, 1.5], [64980, 2]],
    asks: [[65010, 1], [65020, 3]],
    timestamp: Date.now(),
  };
  const funding: RawFundingInfo = {
    fundingRate: 0.0001, fundingIntervalHours: 8,
    nextFundingTimeUtc: Date.now() + 3600000,
    markPrice: 65000, indexPrice: 64995,
  };

  it("builds a valid perp MarketSnapshot with all fields", () => {
    const snap = buildMarketSnapshot("binance", "BTC/USDT", "perp", ticker, ob, funding);
    expect(snap.exchangeId).toBe("binance");
    expect(snap.symbol).toBe("BTC/USDT");
    expect(snap.marketType).toBe("perp");
    expect(snap.bid1).toBe(64990);
    expect(snap.ask1).toBe(65010);
    expect(snap.mid).toBeCloseTo(65000, 0);
    expect(snap.fundingRate).toBe(0.0001);
    expect(snap.fundingIntervalHours).toBe(8);
    expect(snap.nextFundingTimeUtc).toBe(funding.nextFundingTimeUtc);
    expect(snap.markPrice).toBe(65000);
    expect(snap.indexPrice).toBe(64995);
    expect(snap.volume24hUsdt).toBe(1_000_000_000);
    expect(snap.orderBook).toBeDefined();
    expect(snap.orderBook!.bids).toHaveLength(2);
    expect(snap.orderBook!.asks).toHaveLength(2);
    expect(snap.spreadRate).toBeGreaterThan(0);
  });

  it("calculates spreadRate correctly", () => {
    const snap = buildMarketSnapshot("binance", "BTC/USDT", "perp", ticker, ob, funding);
    // mid = (64990+65010)/2 = 65000, spread = (65010-64990)/65000 = 20/65000 ≈ 0.000308
    expect(snap.spreadRate).toBeCloseTo(20 / 65000, 5);
  });

  it("works without funding info (spot snapshot)", () => {
    const snap = buildMarketSnapshot("binance", "BTC/USDT", "spot", ticker, ob);
    expect(snap.marketType).toBe("spot");
    expect(snap.markPrice).toBeUndefined();
    expect(snap.fundingRate).toBeUndefined();
    expect(snap.indexPrice).toBeUndefined();
  });

  it("has timestampUtc set", () => {
    const snap = buildMarketSnapshot("binance", "BTC/USDT", "perp", ticker, ob, funding);
    expect(snap.timestampUtc).toBeGreaterThan(0);
    expect(snap.localReceiveTimeUtc).toBeGreaterThan(0);
  });

  it("tradingStatus defaults to trading", () => {
    const snap = buildMarketSnapshot("binance", "BTC/USDT", "perp", ticker, ob, funding);
    expect(snap.tradingStatus).toBe("trading");
  });
});

describe("rawLevelsToOrderBook", () => {
  it("converts raw arrays to OrderBookLevel[]", () => {
    const result = rawLevelsToOrderBook([[100, 1], [99, 2]]);
    expect(result).toEqual([{ price: 100, qty: 1 }, { price: 99, qty: 2 }]);
  });

  it("handles empty arrays", () => {
    expect(rawLevelsToOrderBook([])).toEqual([]);
  });
});
