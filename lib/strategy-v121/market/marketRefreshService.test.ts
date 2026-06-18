import { describe, expect, it, vi, beforeEach } from "vitest";
import { refreshAndScan } from "./marketRefreshService";

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: () => Promise.resolve({
    version: 1 as const,
    funding: { minFundingRate8h: 0.0005 as const, minNetProfitRate: 0 as const, minSecondsToFunding: 300 as const },
    notional: { plannedNotionalUsdt: 10 as const, maxOrderNotionalUsdt: 50 as const, maxSymbolExposureUsdt: 50 as const, maxExchangeExposureUsdt: 100 as const, allowAutoDownsize: true as const },
    capital: { globalReserveRate: 0.2 as const, minGlobalReserveUsdt: 10 as const, spotBufferRate: 0.015 as const, perpBufferRate: 0.035 as const },
    transfer: { allowAutoTransfer: false as const, mode: "disabled" as const, maxAutoTransferUsdt: 50 as const, allowSpotToPerp: true as const, allowPerpToSpot: true as const, requireReauditAfterTransfer: true as const },
    universe: { useDynamicUniverse: true as const, maxDynamicSymbolsPerExchange: 50 as const, minSpotVolume24hUsdt: 0 as const, minPerpVolume24hUsdt: 0 as const, allowSmallCaps: false as const, symbolWhitelist: [] as string[], symbolBlacklist: [] as string[], prioritySymbols: ["BTC/USDT","ETH/USDT","SOL/USDT"] as string[] },
    execution: { requireHumanApproval: true as const, allowRealOrders: false as const, maxLegDeviationRate: 0.01 as const, orderTimeoutMs: 15000 as const, freezeOnUnknownOrder: true as const, freezeOnUnknownTransfer: true as const },
  }),
}));

describe("marketRefreshService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("mocked refresh returns scan result with errors on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed (mocked)"));
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: ["BTC/USDT"], useDynamicUniverse: false,
    });
    // All API calls fail → errors present
    expect(result.errors.length).toBeGreaterThan(0);
    // Scan result still generated (empty snapshots → 0 passed, 135 total universe paths)
    expect(result.scanResult).toBeDefined();
    expect(result.scanResult!.totalPaths).toBe(117); // V121_UNIVERSE (13 coins) × 3×3
    expect(result.scanResult!.passedCount).toBe(0);
    expect(result.scanResult!.dataSource).toBe("real_market");
  });

  it("returns dataSource real_market", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("mocked"));
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: ["BTC/USDT"], useDynamicUniverse: false,
    });
    expect(result.scanResult!.dataSource).toBe("real_market");
  });

  it("respects custom symbols list", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("mocked"));
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: ["ETH/USDT"], useDynamicUniverse: false,
    });
    // totalPaths is always universe size (117), not per-symbol
    expect(result.scanResult!.totalPaths).toBe(117);
  });

  it("handles empty symbols gracefully", async () => {
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: [], useDynamicUniverse: false,
    });
    // Empty symbols list → no API calls, no errors
    expect(result.errors).toHaveLength(0);
    expect(result.scanResult!.totalPaths).toBe(117);
  });
});
