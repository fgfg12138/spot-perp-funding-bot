import { describe, expect, it } from "vitest";
import { detectCapabilities } from "./capabilityDetector";
import type { IAccountAdapter } from "../account/accountTypes";
import type { ExchangeId } from "../domain/types";

// ─── Mock Adapter Factory ──────────────────────────

function createMockAdapter(overrides: {
  healthCheck?: boolean | Error;
  fetchBalances?: boolean | Error;
  fetchPositions?: boolean | Error;
  fetchOpenOrders?: boolean | Error;
}): IAccountAdapter {
  return {
    exchangeId: "binance" as ExchangeId,
    healthCheck: async () => {
      if (typeof overrides.healthCheck === "boolean") return overrides.healthCheck;
      if (overrides.healthCheck instanceof Error) throw overrides.healthCheck;
      return true;
    },
    fetchBalances: async () => {
      if (typeof overrides.fetchBalances === "boolean") return overrides.fetchBalances ? [{ exchange: "binance" as ExchangeId, asset: "USDT", free: 100, locked: 0, total: 100, fetchedAtUtc: "2025-01-01T00:00:00Z" }] : [];
      if (overrides.fetchBalances instanceof Error) throw overrides.fetchBalances;
      return [{ exchange: "binance" as ExchangeId, asset: "USDT", free: 100, locked: 0, total: 100, fetchedAtUtc: "2025-01-01T00:00:00Z" }];
    },
    fetchPositions: async () => {
      if (typeof overrides.fetchPositions === "boolean") return overrides.fetchPositions ? [] : [];
      if (overrides.fetchPositions instanceof Error) throw overrides.fetchPositions;
      return [];
    },
    fetchOpenOrders: async () => {
      if (typeof overrides.fetchOpenOrders === "boolean") return overrides.fetchOpenOrders ? [] : [];
      if (overrides.fetchOpenOrders instanceof Error) throw overrides.fetchOpenOrders;
      return [];
    },
  };
}

// ─── Tests ──────────────────────────────────────────

describe("capabilityDetector", () => {
  it("全部探测成功时，读取权限为 true", async () => {
    const adapter = createMockAdapter({
      healthCheck: true,
      fetchBalances: true,
      fetchPositions: true,
      fetchOpenOrders: true,
    });

    const report = await detectCapabilities(adapter, "acc_001");

    expect(report.accountId).toBe("acc_001");
    expect(report.exchange).toBe("binance");
    expect(report.capability.readBalance).toBe(true);
    expect(report.capability.positions).toBe(true);
    expect(report.capability.orders).toBe(true);
    expect(report.probes).toHaveLength(4);
    expect(report.probes.every(p => p.success)).toBe(true);
  });

  it("全部失败时，读取权限为 false，有 lastError", async () => {
    const adapter = createMockAdapter({
      healthCheck: new Error("invalid api key"),
      fetchBalances: new Error("permission denied"),
      fetchPositions: new Error("permission denied"),
      fetchOpenOrders: new Error("permission denied"),
    });

    const report = await detectCapabilities(adapter, "acc_002");

    expect(report.capability.readBalance).toBe(false);
    expect(report.capability.positions).toBe(false);
    expect(report.capability.orders).toBe(false);
    expect(report.capability.lastError).toBeDefined();
    expect(report.probes.every(p => !p.success)).toBe(true);
    expect(report.probes[0].error).toBe("invalid api key");
  });

  it("部分成功时正确反映", async () => {
    const adapter = createMockAdapter({
      healthCheck: true,
      fetchBalances: true,
      fetchPositions: new Error("no permission"),
      fetchOpenOrders: true,
    });

    const report = await detectCapabilities(adapter, "acc_003");

    expect(report.capability.readBalance).toBe(true);
    expect(report.capability.positions).toBe(false);
    expect(report.capability.orders).toBe(true);
    expect(report.probes.filter(p => p.success)).toHaveLength(3);
    expect(report.probes.filter(p => !p.success)).toHaveLength(1);
  });

  it("交易类权限始终为 false（需要额外探测）", async () => {
    const adapter = createMockAdapter({});

    const report = await detectCapabilities(adapter, "acc_004");

    expect(report.capability.tradeSpot).toBe(false);
    expect(report.capability.tradePerp).toBe(false);
    expect(report.capability.internalTransfer).toBe(false);
    expect(report.capability.fundingRate).toBe(false);
    expect(report.capability.sameExchangeArbEnabled).toBe(false);
    expect(report.capability.crossExchangeArbEnabled).toBe(false);
  });

  it("lastCheckedAtUtc 和 timestampUtc 已填充", async () => {
    const adapter = createMockAdapter({});
    const report = await detectCapabilities(adapter, "acc_005");

    expect(report.capability.lastCheckedAtUtc).toBeDefined();
    expect(report.timestampUtc).toBeDefined();
    expect(new Date(report.capability.lastCheckedAtUtc!).getTime()).toBeGreaterThan(0);
  });

  it("每个 probe 记录 durationMs", async () => {
    const adapter = createMockAdapter({});
    const report = await detectCapabilities(adapter, "acc_006");

    for (const probe of report.probes) {
      expect(typeof probe.durationMs).toBe("number");
      expect(probe.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("rawJson 包含探测结果", async () => {
    const adapter = createMockAdapter({});
    const report = await detectCapabilities(adapter, "acc_007");

    expect(report.capability.rawJson).toBeDefined();
    const parsed = JSON.parse(report.capability.rawJson!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);
  });

  it("fetchBalances 返回空数组时 readBalance 为 false", async () => {
    const adapter = createMockAdapter({
      fetchBalances: false, // 返回空数组
    });

    const report = await detectCapabilities(adapter, "acc_008");
    expect(report.capability.readBalance).toBe(false);
  });
});
