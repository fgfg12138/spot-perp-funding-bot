import { describe, expect, it, vi, beforeEach } from "vitest";
import { BinancePublicAdapter } from "./binancePublicAdapter";

describe("BinancePublicAdapter", () => {
  let adapter: BinancePublicAdapter;

  beforeEach(() => {
    adapter = new BinancePublicAdapter();
    vi.restoreAllMocks();
  });

  it("has exchangeId = binance", () => {
    expect(adapter.exchangeId).toBe("binance");
  });

  it("parses funding info correctly", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      symbol: "BTCUSDT", markPrice: "65000", indexPrice: "64995",
      lastFundingRate: "0.0001", nextFundingTime: 1719878400000,
    });
    const r = await adapter.fetchFundingInfo("BTCUSDT");
    expect(r.fundingRate).toBe(0.0001);
    expect(r.markPrice).toBe(65000);
    expect(r.indexPrice).toBe(64995);
    expect(r.fundingIntervalHours).toBe(8);
    expect(r.nextFundingTimeUtc).toBe(1719878400000);
  });

  it("parses ticker correctly", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      symbol: "BTCUSDT", lastPrice: "65000", bidPrice: "64990",
      askPrice: "65010", quoteVolume: "1234567890",
      highPrice: "65100", lowPrice: "64800",
    });
    const r = await adapter.fetchTicker("BTCUSDT");
    expect(r.bid1).toBe(64990);
    expect(r.ask1).toBe(65010);
    expect(r.volume24hUsdt).toBe(1234567890);
    expect(r.lastPrice).toBe(65000);
  });

  it("parses order book correctly", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      bids: [["64990", "1.5"], ["64980", "2"]],
      asks: [["65010", "1"], ["65020", "3"]],
    });
    const r = await adapter.fetchOrderBook("BTCUSDT");
    expect(r.bids.length).toBe(2);
    expect(r.bids[0][0]).toBe(64990);
    expect(r.bids[0][1]).toBe(1.5);
    expect(r.asks[1][0]).toBe(65020);
  });

  it("fetchTickerSpot returns spot ticker", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      symbol: "BTCUSDT", lastPrice: "64900", bidPrice: "64890",
      askPrice: "64910", quoteVolume: "500000000",
      highPrice: "65100", lowPrice: "64700",
    });
    const r = await adapter.fetchTickerSpot("BTCUSDT");
    expect(r.bid1).toBe(64890);
    expect(r.ask1).toBe(64910);
  });

  it("fetchOrderBookSpot returns spot order book", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      bids: [["64890", "1"]], asks: [["64910", "2"]],
    });
    const r = await adapter.fetchOrderBookSpot("BTCUSDT");
    expect(r.bids[0][0]).toBe(64890);
  });

  it("health check returns true on success", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({});
    expect(await adapter.healthCheck()).toBe(true);
  });

  it("health check returns false on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("timeout"));
    expect(await adapter.healthCheck()).toBe(false);
  });

  it("getTradingStatus returns trading for active symbol", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      symbols: [{ symbol: "BTCUSDT", status: "TRADING" }],
    });
    const status = await adapter.getTradingStatus("BTCUSDT");
    expect(status).toBe("trading");
  });

  it("getTradingStatus returns halt on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("down"));
    const status = await adapter.getTradingStatus("BTCUSDT");
    expect(status).toBe("halt");
  });
});
