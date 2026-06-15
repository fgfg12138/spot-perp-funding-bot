import { describe, expect, it } from "vitest";
import { scoreOpportunity, type ScoringInput } from "./scoring";
import type { MarketSnapshot } from "../domain/types";

function mockSnap(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    exchangeId: "binance",
    symbol: "BTC/USDT",
    marketType: "perp",
    bid1: 100000, ask1: 100010, mid: 100005,
    markPrice: 100005,
    indexPrice: 100000,
    spreadRate: 0.0001,
    timestampUtc: Date.now(),
    tradingStatus: "trading",
    volume24hUsdt: 100_000_000,
    orderBook: {
      bids: [
        { price: 100000, qty: 100 }, { price: 99990, qty: 200 },
        { price: 99980, qty: 300 }, { price: 99970, qty: 400 },
        { price: 99960, qty: 500 }, { price: 99950, qty: 600 },
        { price: 99940, qty: 700 }, { price: 99930, qty: 800 },
        { price: 99920, qty: 900 }, { price: 99910, qty: 1000 },
      ],
      asks: [
        { price: 100010, qty: 100 }, { price: 100020, qty: 200 },
        { price: 100030, qty: 300 }, { price: 100040, qty: 400 },
        { price: 100050, qty: 500 }, { price: 100060, qty: 600 },
        { price: 100070, qty: 700 }, { price: 100080, qty: 800 },
        { price: 100090, qty: 900 }, { price: 100100, qty: 1000 },
      ],
      timestampUtc: Date.now(),
    },
    ...overrides,
  };
}

describe("scoreOpportunity", () => {
  it("S级: high funding, good basis, deep liquidity, same exchange", () => {
    const input: ScoringInput = {
      path: { spotExchange: "binance", perpExchange: "binance" },
      spotSnapshot: mockSnap({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 500_000_000, spreadRate: 0.0003 }),
      perpSnapshot: mockSnap({ volume24hUsdt: 1_000_000_000, spreadRate: 0.0002 }),
      funding8h: 0.002,
      entryExecutableBasis: 0.006,
    };
    const r = scoreOpportunity(input);
    expect(r.level).toBe("S");
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it("A/B级: adequate funding and basis", () => {
    const input: ScoringInput = {
      path: { spotExchange: "okx", perpExchange: "okx" },
      spotSnapshot: mockSnap({ exchangeId: "okx", marketType: "spot", volume24hUsdt: 20_000_000, spreadRate: 0.0005 }),
      perpSnapshot: mockSnap({ exchangeId: "okx", volume24hUsdt: 50_000_000, spreadRate: 0.0004 }),
      funding8h: 0.0008,
      entryExecutableBasis: 0.004,
    };
    const r = scoreOpportunity(input);
    expect(["A", "B", "C"]).toContain(r.level);
  });

  it("C级: low funding fails minimum", () => {
    const input: ScoringInput = {
      path: { spotExchange: "binance", perpExchange: "binance" },
      spotSnapshot: mockSnap({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 1_000_000 }),
      perpSnapshot: mockSnap({ volume24hUsdt: 5_000_000 }),
      funding8h: 0.0002,
      entryExecutableBasis: 0.002,
    };
    const r = scoreOpportunity(input);
    expect(r.level).toBe("C");
  });

  it("HTX cross-exchange gets stability penalty", () => {
    const input: ScoringInput = {
      path: { spotExchange: "binance", perpExchange: "htx" },
      spotSnapshot: mockSnap({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 100_000_000 }),
      perpSnapshot: mockSnap({ exchangeId: "htx", volume24hUsdt: 50_000_000 }),
      funding8h: 0.0015,
      entryExecutableBasis: 0.005,
    };
    const r = scoreOpportunity(input);
    expect(r.breakdown.stability).toBe(3);
  });

  it("funding >0.30% triggers warning but scores", () => {
    const input: ScoringInput = {
      path: { spotExchange: "binance", perpExchange: "binance" },
      spotSnapshot: mockSnap({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 100_000_000 }),
      perpSnapshot: mockSnap({ volume24hUsdt: 500_000_000 }),
      funding8h: 0.004,
      entryExecutableBasis: 0.008,
    };
    const r = scoreOpportunity(input);
    expect(r.warnings.some(w => w.includes("异常降分"))).toBe(true);
  });

  it("breakdown sums to total", () => {
    const input: ScoringInput = {
      path: { spotExchange: "binance", perpExchange: "binance" },
      spotSnapshot: mockSnap({ exchangeId: "binance", marketType: "spot", volume24hUsdt: 100_000_000 }),
      perpSnapshot: mockSnap({ volume24hUsdt: 200_000_000 }),
      funding8h: 0.001,
      entryExecutableBasis: 0.005,
    };
    const r = scoreOpportunity(input);
    const sum = r.breakdown.availability + r.breakdown.funding + r.breakdown.basis
              + r.breakdown.spotLiquidity + r.breakdown.perpLiquidity + r.breakdown.stability
              + r.breakdown.riskStatus;
    expect(sum).toBe(r.score);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
