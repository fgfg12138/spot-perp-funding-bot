import { describe, expect, it, vi, beforeEach } from "vitest";
import { OkxPublicAdapter } from "./okxPublicAdapter";

describe("OkxPublicAdapter", () => {
  let adapter: OkxPublicAdapter;

  beforeEach(() => {
    adapter = new OkxPublicAdapter();
    vi.restoreAllMocks();
  });

  it("has exchangeId = okx", () => {
    expect(adapter.exchangeId).toBe("okx");
  });

  it("parses funding info", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue([{
      fundingRate: "0.0001", nextFundingTime: "1719878400000", markPrice: "65000",
    }]);
    const r = await adapter.fetchFundingInfo("BTC-USDT-SWAP");
    expect(r.fundingRate).toBe(0.0001);
    expect(r.markPrice).toBe(65000);
    expect(r.fundingIntervalHours).toBe(8);
  });

  it("parses ticker", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue([{
      instId: "BTC-USDT", last: "65000", bidPx: "64990", askPx: "65010",
      volCcy24h: "1234567890", high24h: "65100", low24h: "64800",
    }]);
    const r = await adapter.fetchTicker("BTC-USDT");
    expect(r.bid1).toBe(64990);
    expect(r.ask1).toBe(65010);
    expect(r.volume24hUsdt).toBe(1234567890);
  });

  it("parses order book", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue([{
      bids: [["64990", "1.5", "0", "0"], ["64980", "2", "0", "0"]],
      asks: [["65010", "1", "0", "0"]], ts: "1719878400000",
    }]);
    const r = await adapter.fetchOrderBook("BTC-USDT-SWAP");
    expect(r.bids[0][0]).toBe(64990);
    expect(r.asks[0][0]).toBe(65010);
  });

  it("health check returns true", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue([{ ts: "1" }]);
    expect(await adapter.healthCheck()).toBe(true);
  });

  it("health check returns false on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("timeout"));
    expect(await adapter.healthCheck()).toBe(false);
  });

  it("getTradingStatus returns trading for live instrument", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockResolvedValue([{
      instId: "BTC-USDT-SWAP", state: "live",
    }]);
    expect(await adapter.getTradingStatus("BTC-USDT-SWAP")).toBe("trading");
  });

  it("getTradingStatus returns halt on error", async () => {
    vi.spyOn(adapter as any, "fetchJson").mockRejectedValue(new Error("down"));
    expect(await adapter.getTradingStatus("BTC-USDT-SWAP")).toBe("halt");
  });
});
