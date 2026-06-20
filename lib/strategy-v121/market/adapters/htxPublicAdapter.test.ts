import { describe, expect, it, vi, beforeEach } from "vitest";
import { HtxPublicAdapter } from "./htxPublicAdapter";

describe("HtxPublicAdapter", () => {
  let adapter: HtxPublicAdapter;

  beforeEach(() => {
    adapter = new HtxPublicAdapter();
    vi.restoreAllMocks();
  });

  it("has exchangeId = htx", () => {
    expect(adapter.exchangeId).toBe("htx");
  });

  it("parses funding info", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      status: "ok",
      data: { funding_rate: "0.0001", next_funding_time: 1719878400 },
    });
    const r = await adapter.fetchFundingInfo("BTC-USDT");
    expect(r.fundingRate).toBe(0.0001);
    expect(r.nextFundingTimeUtc).toBe(1719878400000);
    expect(r.fundingIntervalHours).toBe(8);
  });

  it("parses ticker", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      status: "ok",
      tick: { close: 65000, bid: [64990, 1.5], ask: [65010, 1],
        vol: "1234567890", high: 65100, low: 64800 },
    });
    const r = await adapter.fetchTicker("btcusdt");
    expect(r.bid1).toBe(64990);
    expect(r.ask1).toBe(65010);
    expect(r.volume24hUsdt).toBe(1234567890);
  });

  it("parses order book", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      status: "ok",
      tick: { bids: [[64990, 1.5], [64980, 2]], asks: [[65010, 1]] },
    });
    const r = await adapter.fetchOrderBook("btcusdt");
    expect(r.bids[0][0]).toBe(64990);
    expect(r.asks[0][0]).toBe(65010);
    expect(r.bids[1][0]).toBe(64980);
  });

  it("health check returns true", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({ status: "ok", data: {} });
    expect(await adapter.healthCheck()).toBe(true);
  });

  it("health check returns false on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("timeout"));
    expect(await adapter.healthCheck()).toBe(false);
  });

  it("getTradingStatus returns trading when ticker succeeds", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue({
      status: "ok",
      tick: { close: 65000, bid: [64990, 1], ask: [65010, 1], vol: "100", high: 65100, low: 64800 },
    });
    expect(await adapter.getTradingStatus("btcusdt")).toBe("trading");
  });

  it("getTradingStatus returns halt on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("down"));
    expect(await adapter.getTradingStatus("btcusdt")).toBe("halt");
  });

  it("fetchTickerSwap throws on swap endpoint failure (not fake snapshot)", async () => {
    vi.spyOn(adapter as any, "fetchJsonSwap").mockRejectedValue(new Error("htx_swap_ticker_unavailable"));
    await expect(adapter.fetchTickerSwap("BTC-USDT")).rejects.toThrow("htx_swap_ticker_unavailable");
  });

  it("fetchOrderBookSwap throws on swap endpoint failure (not fake snapshot)", async () => {
    vi.spyOn(adapter as any, "fetchJsonSwap").mockRejectedValue(new Error("htx_swap_depth_unavailable"));
    await expect(adapter.fetchOrderBookSwap("BTC-USDT")).rejects.toThrow("htx_swap_depth_unavailable");
  });
});
