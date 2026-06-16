import { describe, expect, it } from "vitest";
import { monitorPosition } from "./monitor";
import type { PositionSnapshot, HealthStatus, ArbitragePath } from "../domain/types";

const path: ArbitragePath = {
  symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: false,
};

function basePos(overrides?: Partial<PositionSnapshot>): PositionSnapshot {
  return {
    positionId: "test-pos-1", path, timestampUtc: Date.now(),
    currentBasis: 0.003, markPrice: 65000, funding8h: 0.001,
    realizedFunding: 2, spotQty: 0.015, spotAvgPrice: 65000,
    perpQty: 0.015, perpAvgPrice: 65020, positionDeviation: 0.002,
    adlLevel: "low", spotDepth: 50000, perpDepth: 200000,
    healthState: { timeSyncMs: 100, wsLatencyMs: 500, restOk: true, wsOk: true, dataFreshnessMs: 1000, isHealthy: true },
    ...overrides,
  };
}

describe("monitorPosition", () => {
  it("healthy position returns hold", () => {
    const r = monitorPosition({
      position: basePos(), spotMarketPrice: 65000,
      perpMarkPrice: 65000, nextFundingRate: 0.001, holdingHours: 2,
    });
    expect(r.action).toBe("hold");
  });

  it("funding turning negative returns exit", () => {
    const r = monitorPosition({
      position: basePos(), spotMarketPrice: 65000,
      perpMarkPrice: 65000, nextFundingRate: -0.001, holdingHours: 2,
    });
    expect(r.action).toBe("exit");
  });

  it("holding > 72h on non-HTX returns exit", () => {
    const r = monitorPosition({
      position: basePos(), spotMarketPrice: 65000,
      perpMarkPrice: 65000, nextFundingRate: 0.0005, holdingHours: 73,
    });
    expect(r.action).toBe("exit");
  });

  it("high deviation triggers freeze", () => {
    const pos = basePos({
      spotQty: 0.015, spotAvgPrice: 65000, // 975 notional
      perpQty: 0.010, perpAvgPrice: 65020, // 650 notional
      // deviation = |975-650|/975 = 33%
    });
    const r = monitorPosition({
      position: pos, spotMarketPrice: 65000,
      perpMarkPrice: 65000, nextFundingRate: 0.001, holdingHours: 1,
    });
    expect(r.action).toBe("freeze");
  });
});
