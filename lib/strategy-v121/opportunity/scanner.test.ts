import { describe, expect, it } from "vitest";
import { scanOpportunities, generateAllPaths } from "./scanner";
import type { MarketSnapshot } from "../domain/types";

function spotSnap(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    exchangeId: "binance", symbol: "BTC/USDT", marketType: "spot",
    bid1: 64990, ask1: 65010, mid: 65000,
    spreadRate: 0.0003, timestampUtc: Date.now(),
    volume24hUsdt: 100_000_000,
    tradingStatus: "trading",
    orderBook: {
      bids: [{ price: 64990, qty: 100 }],
      asks: [{ price: 65010, qty: 100 }],
      timestampUtc: Date.now(),
    },
    ...overrides,
  };
}

function perpSnap(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    exchangeId: "binance", symbol: "BTC/USDT", marketType: "perp",
    bid1: 65020, ask1: 65040, mid: 65030,
    markPrice: 65030, indexPrice: 65000,
    fundingRate: 0.0001, fundingIntervalHours: 8,
    nextFundingTimeUtc: Date.now() + 3600000,
    spreadRate: 0.0003, timestampUtc: Date.now(),
    volume24hUsdt: 500_000_000,
    tradingStatus: "trading",
    orderBook: {
      bids: [{ price: 65020, qty: 100 }],
      asks: [{ price: 65040, qty: 100 }],
      timestampUtc: Date.now(),
    },
    ...overrides,
  };
}

function makeScannerInput() {
  const spots = new Map<string, MarketSnapshot>();
  const perps = new Map<string, MarketSnapshot>();
  spots.set("binance:BTC/USDT", spotSnap());
  perps.set("binance:BTC/USDT", perpSnap());
  return { spotSnapshots: spots, perpSnapshots: perps, systemHealthy: true,
    activeCooldowns: [], plannedNotional: 1000, makerRate: 0.0002,
    takerRate: 0.0007, isTakerEntry: false };
}

describe("generateAllPaths", () => {
  it("generates 124 paths (31×2 same-exchange + 31×2 cross-exchange)", () => {
    const paths = generateAllPaths();
    expect(paths.length).toBe(124); // 31*2 same + 31*2 cross
  });

  it("no paths include non-allowed exchanges", () => {
    const paths = generateAllPaths();
    const invalid = paths.filter(p =>
      !["binance", "okx"].includes(p.spotExchange) ||
      !["binance", "okx"].includes(p.perpExchange)
    );
    expect(invalid).toHaveLength(0);
  });

  it("includes both same-exchange and cross-exchange paths", () => {
    const paths = generateAllPaths();
    const sameEx = paths.filter(p => !p.isCrossExchange);
    const crossEx = paths.filter(p => p.isCrossExchange);
    expect(sameEx).toHaveLength(62);  // 31 × 2 exchanges
    expect(crossEx).toHaveLength(62); // 31 × 2 directions
  });

  it("every cross-exchange path connects binance ↔ okx", () => {
    const paths = generateAllPaths();
    const wrong = paths.filter(p => p.isCrossExchange && !(
      (p.spotExchange === "binance" && p.perpExchange === "okx") ||
      (p.spotExchange === "okx" && p.perpExchange === "binance")
    ));
    expect(wrong).toHaveLength(0);
  });
});

describe("scanOpportunities", () => {
  it("scans and returns opportunities for available snapshots", () => {
    const input = makeScannerInput();
    const output = scanOpportunities(input);
    // Only binance:BTC/USDT has snapshots; okx ones and cross-exchange ones are filtered out
    expect(output.opportunities.length).toBe(1);
    expect(output.totalPaths).toBe(124); // 31×2 same + 31×2 cross
    // With funding 0.01% (< 0.05%), the opportunity should be rejected
  });

  it("opportunity with good funding passes", () => {
    const input = makeScannerInput();
    input.perpSnapshots.set("binance:BTC/USDT", perpSnap({ fundingRate: 0.001 }));
    const output = scanOpportunities(input);
    expect(output.opportunities.length).toBe(1);
    // funding 0.1% >= 0.05% → should pass hard filter
  });

  it("returns rejectReasons when funding is too low", () => {
    const input = makeScannerInput();
    input.perpSnapshots.set("binance:BTC/USDT", perpSnap({ fundingRate: 0.0003 }));
    const output = scanOpportunities(input);
    const opp = output.opportunities[0];
    expect(opp.passed).toBe(false);
    expect(opp.rejectReasons.some(r => r.rule === "funding_too_low")).toBe(true);
  });

  it("filters out paths with missing snapshots", () => {
    const input = makeScannerInput();
    input.spotSnapshots.clear(); // no spot data
    const output = scanOpportunities(input);
    expect(output.opportunities).toHaveLength(0);
  });

  it("active cooldown blocks the path", () => {
    const input = makeScannerInput();
    input.perpSnapshots.set("binance:BTC/USDT", perpSnap({ fundingRate: 0.001 }));
    input.activeCooldowns = [{
      pathKey: "binance:binance:BTC/USDT",
      startedAtUtc: Date.now(),
      durationMinutes: 30,
    }];
    const output = scanOpportunities(input);
    const opp = output.opportunities[0];
    expect(opp.rejectReasons.some(r => r.rule === "cooldown")).toBe(true);
  });

  it("system unhealthy blocks all", () => {
    const input = makeScannerInput();
    input.perpSnapshots.set("binance:BTC/USDT", perpSnap({ fundingRate: 0.001 }));
    input.systemHealthy = false;
    const output = scanOpportunities(input);
    const opp = output.opportunities[0];
    expect(opp.passed).toBe(false);
    expect(opp.rejectReasons.some(r => r.rule === "system_unhealthy")).toBe(true);
  });
});
