import { describe, expect, it, vi, beforeEach } from "vitest";
import { refreshAndScan } from "./marketRefreshService";

// Mock discoverSameExchangeUniverse to avoid real API calls in tests
vi.mock("../market/universeDiscovery", () => ({
  discoverSameExchangeUniverse: () => Promise.resolve([]),
  getUniverseDiscoveryMeta: () => ({ warnings: [], usedCache: false, lastSuccessfulAtUtc: null }),
}));

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: () => Promise.resolve({
    version: 1,
    funding: { minFundingRate8h: 0.0005, minNetProfitRate: 0, minSecondsToFunding: 300 },
    notional: { plannedNotionalUsdt: 10, maxOrderNotionalUsdt: 50, maxSymbolExposureUsdt: 50, maxExchangeExposureUsdt: 100, allowAutoDownsize: true },
    capital: { globalReserveRate: 0.2, minGlobalReserveUsdt: 10, spotBufferRate: 0.015, perpBufferRate: 0.035 },
    transfer: { allowAutoTransfer: false, mode: "disabled", maxAutoTransferUsdt: 50, allowSpotToPerp: true, allowPerpToSpot: true, requireReauditAfterTransfer: true },
    universe: { useDynamicUniverse: true, maxDynamicSymbolsPerExchange: 50, minSpotVolume24hUsdt: 0, minPerpVolume24hUsdt: 0, allowSmallCaps: false, symbolWhitelist: [], symbolBlacklist: [], prioritySymbols: ["BTC/USDT","ETH/USDT","SOL/USDT"] },
    execution: { requireHumanApproval: true, allowRealOrders: false, maxLegDeviationRate: 0.01, orderTimeoutMs: 15000, freezeOnUnknownOrder: true, freezeOnUnknownTransfer: true },
  }),
}));

// Mock opportunity store to avoid persistence side effects
vi.mock("../opportunity/opportunityStore", () => ({
  saveLatestScan: vi.fn(),
}));

// Mock repository
vi.mock("../persistence/repositoryFactory", () => ({
  getRepository: () => ({ save: vi.fn() }),
}));

describe("marketRefreshService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns scan result with empty snapshot map (no dynamic universe items)", async () => {
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
    });
    // No universe items -> nothing to fetch, no errors
    expect(result.errors.length).toBe(0);
    // Scanner generates 112 paths (watchlist-based) but all filtered out due to missing snapshots
    expect(result.scanResult).toBeDefined();
    expect(result.scanResult!.totalPaths).toBe(124);
    expect(result.scanResult!.passedCount).toBe(0);
    expect(result.scanResult!.dataSource).toBe("real_market");
  });
});
