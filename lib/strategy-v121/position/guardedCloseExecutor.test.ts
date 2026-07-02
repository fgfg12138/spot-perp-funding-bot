import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetRuntimeConfig } from "../config/runtimeConfig";

// ── mock data (hoisted) ───────────────────────────────────────
const mockPlan = vi.hoisted(() => ({
  id: "cplan-test",
  positionId: "pos-1",
  exchange: "binance",
  symbol: "BTC/USDT",
  status: "validated",
  blockers: [],
  warnings: [],
  perpLeg: {
    role: "perp_buy_close",
    exchange: "binance",
    symbol: "BTC/USDT",
    market: "perp",
    side: "BUY",
    type: "MARKET",
    quantity: 0.001,
    quoteNotionalUsdt: 50,
    estimatedPrice: 50100,
    clientOrderId: "v121c_perp_test_1",
    reduceOnly: true,
    positionSide: "SHORT",
    constraints: { stepSize: 0.001, minNotional: 5 },
  },
  spotLeg: {
    role: "spot_sell",
    exchange: "binance",
    symbol: "BTC/USDT",
    market: "spot",
    side: "SELL",
    type: "MARKET",
    quantity: 0.001,
    quoteNotionalUsdt: 50,
    estimatedPrice: 50000,
    clientOrderId: "v121c_spot_test_2",
    reduceOnly: true,
    constraints: { stepSize: 0.0001, minNotional: 10 },
  },
  systemRecordQty: { spot: 0.001, perp: 0.001 },
  exchangeActualQty: { spot: 0.001, perp: 0.001 },
  closeQty: { spot: 0.001, perp: 0.001 },
  createdAtUtc: new Date().toISOString(),
  expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
  realCloseEnabled: true,
}));

const mockPosition = vi.hoisted(() => ({
  id: "pos-1",
  state: "OPEN",
  plan: { batches: [] },
  path: { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: false },
  spotFilledQty: 0.001,
  perpFilledQty: 0.001,
  spotAvgPrice: 50000,
  perpAvgPrice: 50100,
  spotNotional: 50,
  perpNotional: 50,
  actualBasis: 0.002,
  positionDeviation: 0,
  createdAtUtc: Date.now(),
  updatedAtUtc: Date.now(),
  logs: [],
}));

const mockSpotBalance = vi.hoisted(() => ({
  exchange: "binance", asset: "BTC", free: 0.001, locked: 0, total: 0.001, fetchedAtUtc: new Date().toISOString(),
}));
const mockPerpShort = vi.hoisted(() => ({
  exchange: "binance", symbol: "BTC/USDT", marketType: "perp", side: "perp_short", quantity: 0.001, notionalUsdt: 50, fetchedAtUtc: new Date().toISOString(),
}));

const mockPerpFilled = vi.hoisted(() => ({
  ok: true, exchange: "binance", symbol: "BTC/USDT", market: "perp", role: "perp_buy_close",
  clientOrderId: "v121c_perp_test_1", exchangeOrderId: "perp123", status: "FILLED",
  executedQty: 0.001, executedQuoteQty: 50.1, avgPrice: 50100, submittedAtUtc: new Date().toISOString(),
}));
const mockSpotFilled = vi.hoisted(() => ({
  ok: true, exchange: "binance", symbol: "BTC/USDT", market: "spot", role: "spot_sell",
  clientOrderId: "v121c_spot_test_2", exchangeOrderId: "spot123", status: "FILLED",
  executedQty: 0.001, executedQuoteQty: 50, avgPrice: 50000, submittedAtUtc: new Date().toISOString(),
}));

const mockSubmitOrderLeg = vi.hoisted(() => vi.fn());
const mockFetchBalances = vi.hoisted(() => vi.fn());
const mockFetchPositions = vi.hoisted(() => vi.fn());
const mockFetchOpenOrders = vi.hoisted(() => vi.fn());
const mockFetchOrderByClientOrderId = vi.hoisted(() => vi.fn());
const mockPaperStoreSave = vi.hoisted(() => vi.fn());

// ── mocks ─────────────────────────────────────────────────────
vi.mock("./closePlanLedger", () => ({
  findClosePlanById: vi.fn().mockResolvedValue(mockPlan),
  saveClosePlan: vi.fn(),
  listRecentClosePlans: vi.fn().mockResolvedValue([]),
  listClosePlansByPositionId: vi.fn().mockResolvedValue([]),
}));

vi.mock("./closeExecutionLedger", () => ({
  saveCloseExecution: vi.fn(),
  updateCloseExecution: vi.fn(),
  findCloseExecutionById: vi.fn().mockResolvedValue(null),
  listRecentCloseExecutions: vi.fn().mockResolvedValue([]),
  listCloseExecutionsByPositionId: vi.fn().mockResolvedValue([]),
}));

vi.mock("../account/adapters/accountAdapterFactory", () => ({
  createAccountAdapter: vi.fn().mockReturnValue({
    adapter: {
      exchangeId: "binance",
      fetchBalances: mockFetchBalances,
      fetchPositions: mockFetchPositions,
      fetchOpenOrders: mockFetchOpenOrders,
      submitOrderLeg: mockSubmitOrderLeg,
      fetchOrderByClientOrderId: mockFetchOrderByClientOrderId,
    },
    dataSource: "mock",
  }),
}));

vi.mock("../execution/paperStore", () => ({
  paperStore: {
    findById: vi.fn().mockReturnValue(mockPosition),
    save: mockPaperStoreSave,
    findAll: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  },
}));

const baseInput = { closePlanId: "cplan-test" };

describe("executeGuardedClose", () => {
  beforeEach(() => {
    // mockReset clears call history AND implementation (incl. once-queue)
    mockSubmitOrderLeg.mockReset();
    mockFetchBalances.mockReset();
    mockFetchPositions.mockReset();
    mockFetchOpenOrders.mockReset();
    mockFetchOrderByClientOrderId.mockReset();
    mockPaperStoreSave.mockReset();

    // 默认快照：有仓位有余额（precheck 能通过）
    mockFetchBalances.mockResolvedValue([mockSpotBalance]);
    mockFetchPositions.mockResolvedValue([mockPerpShort]);
    mockFetchOpenOrders.mockResolvedValue([]);
    // 默认两腿成交
    mockSubmitOrderLeg.mockResolvedValue(mockPerpFilled);
    // 查询订单状态：默认 FILLED（成交后被查询确认）
    mockFetchOrderByClientOrderId.mockResolvedValue({ status: "FILLED", executedQty: 0.001 });

    resetRuntimeConfig({ V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
  });

  afterEach(() => {
    resetRuntimeConfig();
  });

  // ── 前置校验链（不下单）──────────────────────────────────

  it("1. close plan not found → failed", async () => {
    const { findClosePlanById } = await import("./closePlanLedger");
    (findClosePlanById as any).mockResolvedValueOnce(null);
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("close plan not found");
  });

  it("2. close plan not validated → failed", async () => {
    const { findClosePlanById } = await import("./closePlanLedger");
    (findClosePlanById as any).mockResolvedValueOnce({ ...mockPlan, status: "blocked" });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("close plan status");
  });

  it("3. close plan expired → failed", async () => {
    const { findClosePlanById } = await import("./closePlanLedger");
    (findClosePlanById as any).mockResolvedValueOnce({
      ...mockPlan,
      expiresAtUtc: new Date(Date.now() - 1000).toISOString(),
    });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("expired");
  });

  it("4. exchange not supported (htx) → failed", async () => {
    const { findClosePlanById } = await import("./closePlanLedger");
    (findClosePlanById as any).mockResolvedValueOnce({ ...mockPlan, exchange: "htx" });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose(baseInput);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("not supported");
  });

  it("5. dryRun returns prechecked without submitting", async () => {
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: true });
    expect(r.status).toBe("prechecked");
    expect(r.ok).toBe(false);
    expect(mockSubmitOrderLeg).not.toHaveBeenCalled();
  });

  it("6. real close without env → failed", async () => {
    resetRuntimeConfig();
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("failed");
    expect(r.blockers.some((b: string) => b.includes("V121_ENABLE_REAL_CLOSE_EXECUTION"))).toBe(true);
  });

  it("7. real close without correct confirm string → failed", async () => {
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "WRONG_CONFIRM" });
    expect(r.status).toBe("failed");
    expect(r.blockers.some((b: string) => b.includes("explicit_confirm"))).toBe(true);
  });

  it("8. kill switch PAUSE_ALL_AUTOMATION → failed", async () => {
    resetRuntimeConfig({ V121_KILL_SWITCH: "PAUSE_ALL_AUTOMATION", V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("failed");
    expect(r.blockers.some((b: string) => b.includes("PAUSE_ALL_AUTOMATION"))).toBe(true);
  });

  it("9. kill switch PAUSE_NEW_ENTRIES still allows close (EXIT) → closed", async () => {
    resetRuntimeConfig({ V121_KILL_SWITCH: "PAUSE_NEW_ENTRIES", V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
    // 平仓后验证快照：永续清零、余额减少
    mockFetchPositions.mockResolvedValueOnce([mockPerpShort]).mockResolvedValueOnce([]);
    mockFetchBalances.mockResolvedValueOnce([mockSpotBalance]).mockResolvedValueOnce([{ ...mockSpotBalance, free: 0 }]);
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("closed");
  });

  // ── 永续第一腿失败 → protected，不下现货 ──────────────────

  it("10. perp REJECTED → protected, spot not submitted", async () => {
    mockSubmitOrderLeg.mockResolvedValueOnce({
      ...mockPerpFilled, ok: false, status: "REJECTED", error: "insufficient_margin",
    });
    // 查询也返回 REJECTED（订单不存在于交易所）
    mockFetchOrderByClientOrderId.mockResolvedValueOnce({ status: "REJECTED", executedQty: 0 });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(r.perpCloseOrder?.status).toBe("REJECTED");
    expect(mockSubmitOrderLeg).toHaveBeenCalledTimes(1);
    expect(mockPaperStoreSave).toHaveBeenCalled();
  });

  it("11. perp UNKNOWN → protected, spot not submitted", async () => {
    mockSubmitOrderLeg.mockResolvedValueOnce({
      ...mockPerpFilled, ok: true, status: "UNKNOWN",
    });
    mockFetchOrderByClientOrderId.mockResolvedValueOnce({ status: "UNKNOWN" });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(mockSubmitOrderLeg).toHaveBeenCalledTimes(1);
  });

  it("12. perp PARTIALLY_FILLED → protected, no spot", async () => {
    mockSubmitOrderLeg.mockResolvedValueOnce({
      ...mockPerpFilled, status: "PARTIALLY_FILLED", executedQty: 0.0005,
    });
    mockFetchOrderByClientOrderId.mockResolvedValueOnce({ status: "PARTIALLY_FILLED", executedQty: 0.0005 });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(mockSubmitOrderLeg).toHaveBeenCalledTimes(1);
  });

  // ── 永续成交，现货第二腿失败 → protected ──────────────────

  it("13. perp filled, spot REJECTED → protected (perp already closed)", async () => {
    mockSubmitOrderLeg
      .mockResolvedValueOnce(mockPerpFilled)
      .mockResolvedValueOnce({ ...mockSpotFilled, ok: false, status: "REJECTED", error: "insufficient_balance" });
    // perp 查询 FILLED，spot 查询 REJECTED
    mockFetchOrderByClientOrderId
      .mockResolvedValueOnce({ status: "FILLED", executedQty: 0.001 })
      .mockResolvedValueOnce({ status: "REJECTED", executedQty: 0 });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(r.perpCloseOrder?.status).toBe("FILLED");
    expect(r.spotCloseOrder?.status).toBe("REJECTED");
    expect(mockSubmitOrderLeg).toHaveBeenCalledTimes(2);
  });

  it("14. perp filled, spot UNKNOWN → protected", async () => {
    mockSubmitOrderLeg
      .mockResolvedValueOnce(mockPerpFilled)
      .mockResolvedValueOnce({ ...mockSpotFilled, ok: true, status: "UNKNOWN" });
    mockFetchOrderByClientOrderId
      .mockResolvedValueOnce({ status: "FILLED", executedQty: 0.001 })
      .mockResolvedValueOnce({ status: "UNKNOWN" });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
  });

  // ── 平仓后验证 ─────────────────────────────────────────────

  it("15. both filled but verification fails (perp not cleared) → protected", async () => {
    // 平仓后快照：永续 SHORT 仍有残留
    mockFetchPositions.mockResolvedValueOnce([mockPerpShort]).mockResolvedValueOnce([mockPerpShort]);
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(r.verification?.perpShortCleared).toBe(false);
  });

  it("16. both filled, verification passes → closed + position CLOSED", async () => {
    // 平仓后快照：永续清零，现货余额减少
    mockFetchPositions.mockResolvedValueOnce([mockPerpShort]).mockResolvedValueOnce([]);
    mockFetchBalances.mockResolvedValueOnce([mockSpotBalance]).mockResolvedValueOnce([{ ...mockSpotBalance, free: 0 }]);
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("closed");
    expect(r.ok).toBe(true);
    expect(r.verification?.perpShortCleared).toBe(true);
    expect(r.verification?.spotBalanceReduced).toBe(true);
    expect(r.verification?.executedQtyMatched).toBe(true);
    expect(r.finalPnlEstimate).toBeDefined();
    expect(mockPaperStoreSave).toHaveBeenCalled();
  });

  it("17. ledger written before submission (prechecked row)", async () => {
    const { saveCloseExecution } = await import("./closeExecutionLedger");
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    await executeGuardedClose({ ...baseInput, dryRun: true });
    expect(saveCloseExecution).toHaveBeenCalled();
    const saved = (saveCloseExecution as any).mock.calls[0][0];
    expect(saved.status).toBe("prechecked");
    expect(saved.ok).toBe(false);
  });

  it("18. perp submit throws → protected, spot not submitted", async () => {
    mockSubmitOrderLeg.mockRejectedValueOnce(new Error("network timeout"));
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(r.blockers.some((b: string) => b.includes("perp submit error"))).toBe(true);
    expect(mockSubmitOrderLeg).toHaveBeenCalledTimes(1);
  });

  it("19. spot submit throws → protected (perp already closed)", async () => {
    mockSubmitOrderLeg
      .mockResolvedValueOnce(mockPerpFilled)
      .mockRejectedValueOnce(new Error("network timeout"));
    mockFetchOrderByClientOrderId.mockResolvedValueOnce({ status: "FILLED", executedQty: 0.001 });
    const { executeGuardedClose } = await import("./guardedCloseExecutor");
    const r = await executeGuardedClose({ ...baseInput, dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });
    expect(r.status).toBe("protected");
    expect(r.blockers.some((b: string) => b.includes("spot submit error"))).toBe(true);
  });
});
