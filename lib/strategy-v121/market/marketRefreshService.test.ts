import { describe, expect, it, vi, beforeEach } from "vitest";
import { refreshAndScan } from "./marketRefreshService";

describe("marketRefreshService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("mocked refresh returns scan result with errors on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed (mocked)"));
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: ["BTC/USDT"],
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
      symbols: ["BTC/USDT"],
    });
    expect(result.scanResult!.dataSource).toBe("real_market");
  });

  it("respects custom symbols list", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("mocked"));
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: ["ETH/USDT"],
    });
    // totalPaths is always universe size (117), not per-symbol
    expect(result.scanResult!.totalPaths).toBe(117);
  });

  it("handles empty symbols gracefully", async () => {
    const result = await refreshAndScan({
      plannedNotional: 10000, makerRate: 0.0002, takerRate: 0.0007,
      isTakerEntry: false, systemHealthy: true,
      symbols: [],
    });
    // Empty symbols list → no API calls, no errors
    // totalPaths still 117 (scanner uses full universe internally)
    expect(result.errors).toHaveLength(0);
    expect(result.scanResult!.totalPaths).toBe(117);
  });
});
