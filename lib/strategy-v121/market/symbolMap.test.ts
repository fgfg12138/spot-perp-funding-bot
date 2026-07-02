import { describe, expect, it } from "vitest";
import { canonicalToExchange, exchangeToCanonical } from "./symbolMap";

describe("canonicalToExchange", () => {
  it("converts BTC/USDT to Binance format", () => {
    expect(canonicalToExchange("BTC/USDT", "binance", "perp")).toBe("BTCUSDT");
  });

  it("converts BTC/USDT to OKX swap format", () => {
    expect(canonicalToExchange("BTC/USDT", "okx", "perp")).toBe("BTC-USDT-SWAP");
  });

  it("converts BTC/USDT to OKX spot format", () => {
    expect(canonicalToExchange("BTC/USDT", "okx", "spot")).toBe("BTC-USDT");
  });

  it("converts BTC/USDT to HTX format", () => {
    expect(canonicalToExchange("BTC/USDT", "htx", "perp")).toBe("BTC-USDT");
  });

  it("converts to HTX spot lowercase", () => {
    expect(canonicalToExchange("BTC/USDT", "htx", "spot")).toBe("btcusdt");
  });
});

describe("exchangeToCanonical", () => {
  it("converts Binance symbol to canonical", () => {
    expect(exchangeToCanonical("BTCUSDT", "binance", "perp")).toBe("BTC/USDT");
  });

  it("converts OKX swap to canonical", () => {
    expect(exchangeToCanonical("BTC-USDT-SWAP", "okx", "perp")).toBe("BTC/USDT");
  });

  it("converts HTX to canonical", () => {
    expect(exchangeToCanonical("BTC-USDT", "htx", "perp")).toBe("BTC/USDT");
  });
});
