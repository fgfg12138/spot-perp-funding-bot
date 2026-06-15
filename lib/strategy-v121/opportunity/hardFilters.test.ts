import { describe, expect, it } from "vitest";
import { evaluateHardFilters, type HardFilterInput } from "./hardFilters";
import type { MarketSnapshot } from "../domain/types";

function mockSnapshot(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    exchangeId: "binance",
    symbol: "BTC/USDT",
    marketType: "perp",
    bid1: 100000,
    ask1: 100010,
    mid: 100005,
    spreadRate: 0.0001,
    timestampUtc: Date.now(),
    tradingStatus: "trading",
    volume24hUsdt: 100_000_000,
    orderBook: {
      bids: [{ price: 100000, qty: 100 }],
      asks: [{ price: 100010, qty: 100 }],
      timestampUtc: Date.now(),
    },
    ...overrides,
  };
}

const validInput: HardFilterInput = {
  path: { spotExchange: "binance", perpExchange: "binance", symbol: "BTC/USDT" },
  spotSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 50_000_000 }),
  perpSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "perp", volume24hUsdt: 200_000_000 }),
  funding8h: 0.001,
  plannedNotional: 10000,
  isInCooldown: false,
  systemHealthy: true,
  listedHoursAgo: 720,
  perpCanOpen: true,
};

describe("evaluateHardFilters", () => {
  it("passes valid input", () => {
    const r = evaluateHardFilters(validInput);
    expect(r.passed).toBe(true);
    expect(r.rejectReasons).toHaveLength(0);
    expect(r.nextAction).toBe("enter");
  });

  it("rejects exchange not in allowed list", () => {
    const r = evaluateHardFilters({ ...validInput, path: { ...validInput.path, spotExchange: "bybit" as any } });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "exchange_not_allowed")).toBe(true);
  });

  it("rejects funding below 0.05%", () => {
    const r = evaluateHardFilters({ ...validInput, funding8h: 0.0003 });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "funding_too_low")).toBe(true);
  });

  it("rejects funding above 0.50%", () => {
    const r = evaluateHardFilters({ ...validInput, funding8h: 0.006 });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "funding_extreme")).toBe(true);
  });

  it("rejects when in cooldown", () => {
    const r = evaluateHardFilters({ ...validInput, isInCooldown: true });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "cooldown")).toBe(true);
  });

  it("rejects when system unhealthy", () => {
    const r = evaluateHardFilters({ ...validInput, systemHealthy: false });
    expect(r.passed).toBe(false);
    expect(r.nextAction).toBe("freeze");
  });

  it("rejects when spot not trading", () => {
    const r = evaluateHardFilters({
      ...validInput,
      spotSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "spot", tradingStatus: "halt" }),
    });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "spot_not_trading")).toBe(true);
  });

  it("rejects low spot volume", () => {
    const r = evaluateHardFilters({
      ...validInput,
      spotSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 100_000 }),
    });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "spot_volume_too_low")).toBe(true);
  });

  it("rejects wide spot spread", () => {
    const r = evaluateHardFilters({
      ...validInput,
      spotSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "spot", spreadRate: 0.002 }),
    });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "spot_spread_too_wide")).toBe(true);
  });

  it("triggers wide spread downgrade at >0.30%", () => {
    const r = evaluateHardFilters({
      ...validInput,
      spotSnapshot: mockSnapshot({ exchangeId: "binance", marketType: "spot", spreadRate: 0.004 }),
    });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "wide_spread_downgrade")).toBe(true);
  });

  it("rejects newly listed <24h", () => {
    const r = evaluateHardFilters({ ...validInput, listedHoursAgo: 12 });
    expect(r.passed).toBe(false);
    expect(r.rejectReasons.some(rs => rs.rule === "too_new")).toBe(true);
  });
});
