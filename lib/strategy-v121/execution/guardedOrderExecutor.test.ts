import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeGuardedTwoLegOrder } from "./guardedOrderExecutor";

const mockPlan = vi.hoisted(() => ({
  id: "oplan-test", intentId: "intent-test",
  exchange: "binance", symbol: "BTC/USDT", plannedNotionalUsdt: 10,
  status: "validated", blockers: [], warnings: [],
  spotLeg: { role: "spot_buy", exchange: "binance", symbol: "BTC/USDT", market: "spot", side: "BUY", type: "MARKET", quantity: 0.0001, quoteNotionalUsdt: 10, estimatedPrice: 60000, clientOrderId: "v121_spot_test_1234", reduceOnly: false, constraints: { stepSize: 0.00001, minNotional: 5 } },
  perpLeg: { role: "perp_short", exchange: "binance", symbol: "BTC/USDT", market: "perp", side: "SELL", type: "MARKET", quantity: 0.0001, quoteNotionalUsdt: 10, estimatedPrice: 60001, clientOrderId: "v121_perp_test_1234", reduceOnly: false, positionSide: "SHORT", constraints: { stepSize: 0.001, minNotional: 5 } },
  allowedForActualOrder: false as const,
  createdAtUtc: new Date().toISOString(),
  expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
}));

const mockSpotResult = vi.hoisted(() => ({ ok: true, exchange: "binance", symbol: "BTC/USDT", market: "spot", role: "spot_buy", clientOrderId: "v121_spot_test_1234", exchangeOrderId: "spot12345", status: "FILLED", executedQty: 0.0001, executedQuoteQty: 10, submittedAtUtc: new Date().toISOString() }));
const mockPerpResult = vi.hoisted(() => ({ ok: true, exchange: "binance", symbol: "BTC/USDT", market: "perp", role: "perp_short", clientOrderId: "v121_perp_test_1234", exchangeOrderId: "perp12345", status: "FILLED", executedQty: 0.0001, executedQuoteQty: 10, submittedAtUtc: new Date().toISOString() }));
const mockSubmitOrderLeg = vi.hoisted(() => vi.fn());
const mockFetchOpenOrders = vi.hoisted(() => vi.fn());

vi.mock("./orderPlanLedger", () => ({
  findOrderPlanById: vi.fn().mockResolvedValue(mockPlan),
  listRecentOrderPlans: vi.fn().mockResolvedValue([]),
  saveOrderPlan: vi.fn(),
}));

vi.mock("./orderExecutionLedger", () => ({
  saveOrderExecution: vi.fn(),
  updateOrderExecution: vi.fn(),
  listRecentOrderExecutions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./preOrderExecutionGate", () => ({
  runPreOrderExecutionGate: vi.fn().mockResolvedValue({ ok: true, status: "validated", blockers: [], warnings: [], evidence: {} }),
}));

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: vi.fn().mockResolvedValue({
    execution: { allowRealOrders: true, maxLegDeviationRate: 0.01 },
    notional: { maxOrderNotionalUsdt: 50 },
  }),
}));

vi.mock("../account/adapters/accountAdapterFactory", () => ({
  createAccountAdapter: vi.fn().mockReturnValue({
    adapter: {
      exchangeId: "binance",
      fetchOpenOrders: mockFetchOpenOrders,
      submitOrderLeg: mockSubmitOrderLeg,
      fetchOrderByClientOrderId: vi.fn().mockResolvedValue({ status: "FILLED" }),
    },
    dataSource: "mock",
  }),
}));

const baseInput = { orderPlanId: "oplan-test" };

describe("executeGuardedTwoLegOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitOrderLeg.mockResolvedValue(mockSpotResult);
    mockFetchOpenOrders.mockResolvedValue([]);
  });

  it("1. order plan not found → failed", async () => {
    const { findOrderPlanById } = await import("./orderPlanLedger");
    (findOrderPlanById as any).mockResolvedValueOnce(null);
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("order plan not found");
  });

  it("2. order plan not validated → blocked", async () => {
    const { findOrderPlanById } = await import("./orderPlanLedger");
    (findOrderPlanById as any).mockResolvedValueOnce({ ...mockPlan, status: "blocked" });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
  });

  it("3. order plan expired → stale/blocked", async () => {
    const { findOrderPlanById } = await import("./orderPlanLedger");
    (findOrderPlanById as any).mockResolvedValueOnce({ ...mockPlan, expiresAtUtc: new Date(Date.now() - 1000).toISOString() });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
  });

  it("4. exchange not binance → blocked", async () => {
    const { findOrderPlanById } = await import("./orderPlanLedger");
    (findOrderPlanById as any).mockResolvedValueOnce({ ...mockPlan, exchange: "okx" });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("not supported");
  });

  it("5. allowRealOrders=false → blocked", async () => {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    (loadSettings as any).mockResolvedValueOnce({
      execution: { allowRealOrders: false }, notional: { maxOrderNotionalUsdt: 50 },
    });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.blockers[0]).toContain("allowRealOrders");
  });

  it("6. dryRun=false but env not set → blocked", async () => {
    const r = await executeGuardedTwoLegOrder({ ...baseInput, dryRun: false });
    expect(r.blockers.some((b: string) => b.includes("V121_ENABLE_REAL_ORDER_EXECUTION"))).toBe(true);
  });

  it("7. dryRun=false but explicitConfirm missing → blocked", async () => {
    const r = await executeGuardedTwoLegOrder({ ...baseInput, dryRun: false, explicitConfirm: "wrong" });
    expect(r.blockers.some((b: string) => b.includes("explicit_confirm"))).toBe(true);
  });

  it("8. kill switch → blocked", async () => {
    const orig = process.env.V121_KILL_SWITCH;
    process.env.V121_KILL_SWITCH = "PAUSE_NEW_ENTRIES";
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.blockers.some((b: string) => b.includes("kill switch"))).toBe(true);
    process.env.V121_KILL_SWITCH = orig;
  });

  it("9. open order conflict → frozen", async () => {
    mockFetchOpenOrders.mockResolvedValue([{ symbol: "BTC/USDT", status: "NEW" }]);
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("frozen");
    expect(r.blockers.some((b: string) => b.includes("open order"))).toBe(true);
  });

  it("10. spot fail → frozen, perp not submitted", async () => {
    mockSubmitOrderLeg.mockResolvedValueOnce({ ok: false, exchange: "binance", symbol: "BTC/USDT", market: "spot", role: "spot_buy", clientOrderId: "test", status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: "insufficient_balance" });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("spot REJECTED");
  });

  it("11. spot unknown → frozen, perp not submitted", async () => {
    mockSubmitOrderLeg.mockResolvedValueOnce({ ok: true, exchange: "binance", symbol: "BTC/USDT", market: "spot", role: "spot_buy", clientOrderId: "test", status: "UNKNOWN", submittedAtUtc: new Date().toISOString() });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("frozen");
  });

  it("12. spot ok, perp fail → frozen", async () => {
    mockSubmitOrderLeg
      .mockResolvedValueOnce(mockSpotResult)
      .mockResolvedValueOnce({ ok: false, status: "REJECTED", error: "perp error" });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("perp REJECTED");
  });

  it("13. spot ok, perp unknown → frozen", async () => {
    mockSubmitOrderLeg
      .mockResolvedValueOnce(mockSpotResult)
      .mockResolvedValueOnce({ ok: true, status: "UNKNOWN" });
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("frozen");
  });

  it("14. dryRun does not call real env checks", async () => {
    const r = await executeGuardedTwoLegOrder(baseInput);
    expect(r.status).toBe("dry_run");
    expect(r.spot?.status).toBe("FILLED");
    expect(r.perp?.status).toBe("FILLED");
  });
});
