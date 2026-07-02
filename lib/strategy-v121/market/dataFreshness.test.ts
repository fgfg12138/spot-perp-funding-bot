import { describe, expect, it } from "vitest";
import { isSnapshotFresh, isSpreadTooWide, validateSnapshot } from "./dataFreshness";
import type { MarketSnapshot } from "../domain/types";

function snap(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    exchangeId: "binance", symbol: "BTC/USDT", marketType: "perp",
    bid1: 64990, ask1: 65010, mid: 65000,
    markPrice: 65000, indexPrice: 64995,
    spreadRate: 0.0003, timestampUtc: Date.now(),
    volume24hUsdt: 1_000_000_000,
    tradingStatus: "trading",
    ...overrides,
  };
}

describe("isSnapshotFresh", () => {
  it("returns true for fresh snapshot", () => {
    expect(isSnapshotFresh(snap())).toBe(true);
  });

  it("returns false for stale snapshot", () => {
    const stale = snap({ timestampUtc: Date.now() - 15000 });
    expect(isSnapshotFresh(stale)).toBe(false);
  });

  it("respects custom maxAgeMs", () => {
    const s = snap({ timestampUtc: Date.now() - 5000 });
    expect(isSnapshotFresh(s, 10000)).toBe(true);
    expect(isSnapshotFresh(s, 3000)).toBe(false);
  });
});

describe("isSpreadTooWide", () => {
  it("normal spread < 0.10%", () => {
    expect(isSpreadTooWide(snap({ spreadRate: 0.0005 })).level).toBe("normal");
  });

  it("wide spread 0.10%–0.30%", () => {
    const r = isSpreadTooWide(snap({ spreadRate: 0.002 }));
    expect(r.tooWide).toBe(true);
    expect(r.shouldDowngrade).toBe(false);
  });

  it("downgrade > 0.30%", () => {
    const r = isSpreadTooWide(snap({ spreadRate: 0.004 }));
    expect(r.tooWide).toBe(true);
    expect(r.shouldDowngrade).toBe(true);
  });
});

describe("validateSnapshot", () => {
  it("valid perp snapshot passes", () => {
    expect(validateSnapshot(snap()).valid).toBe(true);
  });

  it("missing markPrice on perp fails", () => {
    const r = validateSnapshot(snap({ markPrice: undefined }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain("markPrice");
  });

  it("markPrice=0 fails on perp", () => {
    const r = validateSnapshot(snap({ markPrice: 0 }));
    expect(r.valid).toBe(false);
    expect(r.missingFields).toContain("markPrice");
  });

  it("spot snapshot without markPrice passes", () => {
    const r = validateSnapshot(snap({ marketType: "spot", markPrice: undefined }));
    expect(r.valid).toBe(true);
  });
});
