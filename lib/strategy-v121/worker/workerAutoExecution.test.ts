import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExchangeId, StrategyMode } from "../domain/types";
import type { PaperExecution } from "../execution/paperLifecycle";
import type { SafeExecutionDecision } from "../execution/safeExecutionOrchestrator";
import type { TwoLegOrderPlan } from "../execution/orderTypes";
import type { ClosePlan } from "../position/closeExecutionTypes";

import {
  tryAutoEntry,
  tryAutoMonitor,
  checkEntryPreconditions,
  selectBestCandidate,
  runEntrySafeDecision,
  handleTransferRequired,
  dispatchToOrderPlan,
  fetchEntryPrices,
  buildAndSaveOrderPlan,
  submitTwoLegOrderAndRecordPosition,
  listMonitorablePositions,
  evaluateSinglePosition,
  executeMonitorAction,
  fetchCloseExchangeSnapshot,
  fetchCloseOrderBook,
  buildAndSaveClosePlan,
  submitGuardedClose,
} from "./workerAutoExecution";

import {
  formatRawSymbolForExchange,
  isEntryResultSuccessful,
  extractSpotBalance,
  extractPerpShortPosition,
  isRealCloseEnabled,
} from "./workerExecutionHelpers";

import { BinancePublicAdapter } from "../market/adapters/binancePublicAdapter";
import { resetRuntimeConfig } from "../config/runtimeConfig";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockCanPlaceRealOrders = vi.hoisted(() => vi.fn());
const mockGetLatestScan = vi.hoisted(() => vi.fn());
const mockLoadSettings = vi.hoisted(() => vi.fn());
const mockFindAll = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());
const mockRunSafeExecutionDecision = vi.hoisted(() => vi.fn());
const mockExecuteAutoTransferAndReaudit = vi.hoisted(() => vi.fn());
const mockBuildTwoLegOrderPlan = vi.hoisted(() => vi.fn());
const mockSaveOrderPlan = vi.hoisted(() => vi.fn());
const mockExecuteGuardedTwoLegOrder = vi.hoisted(() => vi.fn());
const mockMonitorPosition = vi.hoisted(() => vi.fn());
const mockBuildClosePlan = vi.hoisted(() => vi.fn());
const mockSaveClosePlan = vi.hoisted(() => vi.fn());
const mockExecuteGuardedClose = vi.hoisted(() => vi.fn());
const mockCreatePaperExecution = vi.hoisted(() => vi.fn());
const mockFetchTickerSpot = vi.hoisted(() => vi.fn());
const mockFetchTicker = vi.hoisted(() => vi.fn());
const mockFetchBalances = vi.hoisted(() => vi.fn());
const mockFetchPositions = vi.hoisted(() => vi.fn());
const mockFetchOpenOrders = vi.hoisted(() => vi.fn());
const mockCreateAccountAdapter = vi.hoisted(() => vi.fn());

vi.mock("../config/strategyConfig", () => ({
  getConfig: mockGetConfig,
  canPlaceRealOrders: mockCanPlaceRealOrders,
}));

vi.mock("../opportunity/opportunityStore", () => ({
  getLatestScan: mockGetLatestScan,
}));

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: mockLoadSettings,
}));

vi.mock("../execution/paperStore", () => ({
  paperStore: { findAll: mockFindAll, save: mockSave },
}));

vi.mock("../execution/safeExecutionOrchestrator", () => ({
  runSafeExecutionDecision: mockRunSafeExecutionDecision,
}));

vi.mock("../execution/autoTransferExecutor", () => ({
  executeAutoTransferAndReaudit: mockExecuteAutoTransferAndReaudit,
}));

vi.mock("../execution/orderPlanBuilder", () => ({
  buildTwoLegOrderPlan: mockBuildTwoLegOrderPlan,
}));

vi.mock("../execution/orderPlanLedger", () => ({
  saveOrderPlan: mockSaveOrderPlan,
}));

vi.mock("../execution/guardedOrderExecutor", () => ({
  executeGuardedTwoLegOrder: mockExecuteGuardedTwoLegOrder,
}));

vi.mock("../position/monitor", () => ({
  monitorPosition: mockMonitorPosition,
}));

vi.mock("../position/closePlanBuilder", () => ({
  buildClosePlan: mockBuildClosePlan,
}));

vi.mock("../position/closePlanLedger", () => ({
  saveClosePlan: mockSaveClosePlan,
}));

vi.mock("../position/guardedCloseExecutor", () => ({
  executeGuardedClose: mockExecuteGuardedClose,
}));

vi.mock("../execution/paperLifecycle", () => ({
  createPaperExecution: mockCreatePaperExecution,
}));

vi.mock("../market/adapters/binancePublicAdapter", () => ({
  BinancePublicAdapter: vi.fn().mockImplementation(() => ({
    fetchTickerSpot: mockFetchTickerSpot,
    fetchTicker: mockFetchTicker,
  })),
}));

vi.mock("../market/adapters/okxPublicAdapter", () => ({
  OkxPublicAdapter: vi.fn().mockImplementation(() => ({
    fetchTickerSpot: mockFetchTickerSpot,
    fetchTicker: mockFetchTicker,
  })),
}));

vi.mock("../account/adapters/accountAdapterFactory", () => ({
  createAccountAdapter: mockCreateAccountAdapter,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeOpp(overrides: any = {}) {
  return {
    symbol: "BTC/USDT",
    path: { spotExchange: "binance", perpExchange: "binance", symbol: "BTC/USDT" },
    level: "S",
    score: 100,
    funding8h: 0.01,
    passed: true,
    ...overrides,
  };
}

function makeDecision(overrides: any = {}): SafeExecutionDecision {
  return {
    state: "FINAL_AUDIT_READY",
    intentId: "intent-1",
    sessionId: "session-1",
    blockers: [],
    warnings: [],
    needsAutoTransfer: false,
    ...overrides,
  } as SafeExecutionDecision;
}

function makePosition(overrides: any = {}): PaperExecution {
  return {
    id: "pos-1",
    state: "MONITORING",
    path: { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: false },
    spotFilledQty: 0.001,
    perpFilledQty: 0.001,
    spotAvgPrice: 60000,
    perpAvgPrice: 60001,
    spotNotional: 60,
    perpNotional: 60,
    actualBasis: 0.00001,
    positionDeviation: 0,
    createdAtUtc: Date.now() - 3600_000,
    updatedAtUtc: Date.now(),
    logs: [],
    plan: { id: "plan-1", batches: [], totalNotionalUsdt: 60 },
    ...overrides,
  };
}

function makeOrderPlan(overrides: any = {}): TwoLegOrderPlan {
  return {
    id: "oplan-1",
    status: "validated",
    blockers: [],
    warnings: [],
    exchange: "binance",
    symbol: "BTC/USDT",
    plannedNotionalUsdt: 10,
    spotLeg: {
      role: "spot_buy", market: "spot", exchange: "binance", symbol: "BTC/USDT",
      side: "BUY", type: "MARKET", quantity: 0.0001, quoteNotionalUsdt: 10,
      estimatedPrice: 60000, clientOrderId: "c1", reduceOnly: false, constraints: {},
    },
    perpLeg: {
      role: "perp_short", market: "perp", exchange: "binance", symbol: "BTC/USDT",
      side: "SELL", type: "MARKET", quantity: 0.001, quoteNotionalUsdt: 10,
      estimatedPrice: 60001, clientOrderId: "c2", reduceOnly: false, positionSide: "SHORT", constraints: {},
    },
    createdAtUtc: new Date().toISOString(),
    expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    allowedForActualOrder: false,
    ...overrides,
  };
}

function makeClosePlan(overrides: any = {}): ClosePlan {
  return {
    id: "cplan-1",
    positionId: "pos-1",
    exchange: "binance",
    symbol: "BTC/USDT",
    status: "validated",
    blockers: [],
    warnings: [],
    systemRecordQty: { spot: 0.001, perp: 0.001 },
    exchangeActualQty: { spot: 0.001, perp: 0.001 },
    closeQty: { spot: 0.001, perp: 0.001 },
    createdAtUtc: new Date().toISOString(),
    expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    realCloseEnabled: false,
    perpLeg: {
      role: "perp_buy_close", market: "perp", exchange: "binance", symbol: "BTC/USDT",
      side: "BUY", type: "MARKET", quantity: 0.001, quoteNotionalUsdt: 60,
      estimatedPrice: 60000, clientOrderId: "pc1", reduceOnly: true, positionSide: "SHORT", constraints: {},
    },
    spotLeg: {
      role: "spot_sell", market: "spot", exchange: "binance", symbol: "BTC/USDT",
      side: "SELL", type: "MARKET", quantity: 0.001, quoteNotionalUsdt: 60,
      estimatedPrice: 60000, clientOrderId: "pc2", reduceOnly: true, constraints: {},
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("workerExecutionHelpers", () => {
  it("formatRawSymbolForExchange formats symbols", () => {
    expect(formatRawSymbolForExchange("BTC/USDT", "binance")).toBe("BTCUSDT");
    expect(formatRawSymbolForExchange("BTC/USDT", "okx")).toBe("BTC-USDT");
    expect(formatRawSymbolForExchange("BTC/USDT", "htx")).toBe("BTC/USDT");
  });

  it("isEntryResultSuccessful recognizes filled and dry_run", () => {
    expect(isEntryResultSuccessful("filled")).toBe(true);
    expect(isEntryResultSuccessful("dry_run")).toBe(true);
    expect(isEntryResultSuccessful("rejected")).toBe(false);
  });

  it("extractSpotBalance finds base asset", () => {
    const balances = [{ asset: "BTC" }, { asset: "USDT" }];
    expect(extractSpotBalance(balances, "BTC")).toEqual({ asset: "BTC" });
    expect(extractSpotBalance(balances, "ETH")).toBeNull();
  });

  it("extractPerpShortPosition finds perp_short", () => {
    const positions = [{ symbol: "BTC/USDT", side: "spot_long" }, { symbol: "BTC/USDT", side: "perp_short" }];
    expect(extractPerpShortPosition(positions, "BTC/USDT")).toEqual({ symbol: "BTC/USDT", side: "perp_short" });
    expect(extractPerpShortPosition(positions, "ETH/USDT")).toBeNull();
  });

  it("isRealCloseEnabled respects mode and env", () => {
    // SHADOW mode always returns false regardless of env
    process.env.V121_ENABLE_REAL_CLOSE_EXECUTION = "1";
    resetRuntimeConfig();
    expect(isRealCloseEnabled("SHADOW")).toBe(false);

    // MAINNET_TINY with ENABLE_REAL_CLOSE=1 → true
    process.env.V121_MODE = "MAINNET_TINY";
    process.env.V121_ENABLE_REAL_CLOSE_EXECUTION = "1";
    resetRuntimeConfig();
    expect(isRealCloseEnabled("MAINNET_TINY")).toBe(true);

    // MAINNET_TINY without ENABLE_REAL_CLOSE → false
    delete process.env.V121_ENABLE_REAL_CLOSE_EXECUTION;
    resetRuntimeConfig();
    expect(isRealCloseEnabled("MAINNET_TINY")).toBe(false);

    // cleanup
    delete process.env.V121_MODE;
    delete process.env.V121_ENABLE_REAL_CLOSE_EXECUTION;
    resetRuntimeConfig();
  });
});

describe("checkEntryPreconditions", () => {
  beforeEach(() => {
    mockGetLatestScan.mockReturnValue({ opportunities: [makeOpp()] });
    mockFindAll.mockReturnValue([]);
  });

  it("skips READ_ONLY mode", () => {
    const r = checkEntryPreconditions({ mode: "READ_ONLY" as StrategyMode }, "w1");
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("READ_ONLY");
  });

  it("skips PAPER mode", () => {
    const r = checkEntryPreconditions({ mode: "PAPER" as StrategyMode }, "w1");
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("PAPER");
  });

  it("skips when no scan", () => {
    mockGetLatestScan.mockReturnValue(null);
    const r = checkEntryPreconditions({ mode: "MAINNET_TINY" as StrategyMode }, "w1");
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("无扫描结果");
  });

  it("skips when open positions exist", () => {
    mockFindAll.mockReturnValue([makePosition()]);
    const r = checkEntryPreconditions({ mode: "MAINNET_TINY" as StrategyMode }, "w1");
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("已有");
  });

  it("passes when conditions met", () => {
    const r = checkEntryPreconditions({ mode: "MAINNET_TINY" as StrategyMode }, "w1");
    expect(r.ok).toBe(true);
  });
});

describe("selectBestCandidate", () => {
  const settings = { notional: { plannedNotionalUsdt: 10 }, funding: { minFundingRate8h: 0.0005 } };

  it("returns skip when no opportunities", async () => {
    const r = await selectBestCandidate({ opportunities: [] }, settings);
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("无合格");
  });

  it("filters out non-S/A candidates", async () => {
    const opps = [makeOpp({ level: "B" }), makeOpp({ level: "C" })];
    const r = await selectBestCandidate({ opportunities: opps }, settings);
    expect(r.ok).toBe(false);
  });

  it("filters out cross-exchange candidates", async () => {
    const opps = [makeOpp({ path: { spotExchange: "binance", perpExchange: "okx" } })];
    const r = await selectBestCandidate({ opportunities: opps }, settings);
    expect(r.ok).toBe(false);
  });

  it("filters out HTX candidates", async () => {
    const opps = [makeOpp({ path: { spotExchange: "htx", perpExchange: "htx" } })];
    const r = await selectBestCandidate({ opportunities: opps }, settings);
    expect(r.ok).toBe(false);
  });

  it("filters out low funding opportunities", async () => {
    const opps = [makeOpp({ funding8h: 0.0001 })];
    const r = await selectBestCandidate({ opportunities: opps }, settings);
    expect(r.ok).toBe(false);
  });

  it("selects highest score candidate", async () => {
    const opps = [
      makeOpp({ symbol: "ETH/USDT", score: 80 }),
      makeOpp({ symbol: "BTC/USDT", score: 120 }),
    ];
    const r = await selectBestCandidate({ opportunities: opps }, settings);
    expect(r.ok).toBe(true);
    expect(r.symbol).toBe("BTC/USDT");
    expect(r.exchange).toBe("binance");
    expect(r.plannedNotional).toBe(10);
  });
});

describe("runEntrySafeDecision", () => {
  it("calls runSafeExecutionDecision with correct args", async () => {
    mockCanPlaceRealOrders.mockReturnValue(true);
    mockRunSafeExecutionDecision.mockResolvedValue(makeDecision());
    await runEntrySafeDecision({
      intentId: "i1",
      exchange: "binance",
      symbol: "BTC/USDT",
      plannedNotionalUsdt: 10,
      mode: "MAINNET_TINY",
    });
    expect(mockRunSafeExecutionDecision).toHaveBeenCalledWith(expect.objectContaining({
      intentId: "i1",
      exchange: "binance",
      symbol: "BTC/USDT",
      plannedNotionalUsdt: 10,
      purpose: "real_arbitrage",
      simulationOnly: false,
      realTradeEligible: true,
    }));
  });
});

describe("fetchEntryPrices", () => {
  beforeEach(() => {
    mockFetchTickerSpot.mockReset();
    mockFetchTicker.mockReset();
  });

  it("fetches binance spot/perp prices", async () => {
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ ask1: 60001 });
    const r = await fetchEntryPrices("binance", "BTC/USDT", "w1");
    expect(r.ok).toBe(true);
    expect(r.spotPrice).toBe(60000);
    expect(r.perpPrice).toBe(60001);
  });

  it("fetches okx spot/perp prices", async () => {
    mockFetchTickerSpot.mockResolvedValue({ bid1: 61000 });
    mockFetchTicker.mockResolvedValue({ ask1: 61001 });
    const r = await fetchEntryPrices("okx", "BTC/USDT", "w1");
    expect(r.ok).toBe(true);
    expect(r.spotPrice).toBe(61000);
    expect(r.perpPrice).toBe(61001);
  });

  it("uses fallback when adapter constructor fails", async () => {
    (BinancePublicAdapter as any).mockImplementationOnce(() => { throw new Error("network"); });
    const r = await fetchEntryPrices("binance", "BTC/USDT", "w1");
    expect(r.ok).toBe(true);
    expect(r.spotPrice).toBe(60000);
    expect(r.perpPrice).toBe(60001);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("returns ok=false when individual prices are zero", async () => {
    mockFetchTickerSpot.mockResolvedValue({ bid1: 0 });
    mockFetchTicker.mockResolvedValue({ ask1: 0 });
    const r = await fetchEntryPrices("binance", "BTC/USDT", "w1");
    expect(r.ok).toBe(false);
  });
});

describe("buildAndSaveOrderPlan", () => {
  it("saves validated plan", async () => {
    const plan = makeOrderPlan();
    mockBuildTwoLegOrderPlan.mockResolvedValue(plan);
    const r = await buildAndSaveOrderPlan(makeDecision(), "BTC/USDT", "binance", 10, {
      ok: true, spotPrice: 60000, perpPrice: 60001, warnings: [],
    }, { spot: {}, perp: {} });
    expect(r.ok).toBe(true);
    expect(r.orderPlan).toBe(plan);
    expect(mockSaveOrderPlan).toHaveBeenCalledWith(plan);
  });

  it("returns blockers when plan invalid", async () => {
    const plan = makeOrderPlan({ status: "blocked", blockers: ["notional too small"] });
    mockBuildTwoLegOrderPlan.mockResolvedValue(plan);
    const r = await buildAndSaveOrderPlan(makeDecision(), "BTC/USDT", "binance", 10, {
      ok: true, spotPrice: 60000, perpPrice: 60001, warnings: [],
    }, { spot: {}, perp: {} });
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("notional too small");
    expect(mockSaveOrderPlan).not.toHaveBeenCalled();
  });
});

describe("submitTwoLegOrderAndRecordPosition", () => {
  beforeEach(() => {
    mockCreatePaperExecution.mockReturnValue(makePosition({ state: "IDLE" }));
  });

  it("records position on filled", async () => {
    const plan = makeOrderPlan();
    mockExecuteGuardedTwoLegOrder.mockResolvedValue({ status: "filled", id: "exec-1" });
    const r = await submitTwoLegOrderAndRecordPosition(
      plan, "w1", "MAINNET_TINY",
      { ok: true, spotPrice: 60000, perpPrice: 60001, warnings: [] },
      "BTC/USDT", "binance", 10, makeDecision(),
    );
    expect(r.action).toBe("order_placed");
    expect(mockCreatePaperExecution).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });

  it("returns order_placed on dry_run", async () => {
    const plan = makeOrderPlan();
    mockExecuteGuardedTwoLegOrder.mockResolvedValue({ status: "dry_run" });
    const r = await submitTwoLegOrderAndRecordPosition(
      plan, "w1", "SHADOW",
      { ok: true, spotPrice: 60000, perpPrice: 60001, warnings: [] },
      "BTC/USDT", "binance", 10, makeDecision(),
    );
    expect(r.action).toBe("order_placed");
    expect(mockCreatePaperExecution).not.toHaveBeenCalled();
  });

  it("returns blocked on failure", async () => {
    const plan = makeOrderPlan();
    mockExecuteGuardedTwoLegOrder.mockResolvedValue({ status: "rejected", blockers: ["timeout"] });
    const r = await submitTwoLegOrderAndRecordPosition(
      plan, "w1", "MAINNET_TINY",
      { ok: true, spotPrice: 60000, perpPrice: 60001, warnings: [] },
      "BTC/USDT", "binance", 10, makeDecision(),
    );
    expect(r.action).toBe("blocked");
    expect(r.message).toContain("timeout");
  });
});

describe("listMonitorablePositions", () => {
  it("skips READ_ONLY mode", () => {
    const r = listMonitorablePositions("READ_ONLY");
    expect(r.ok).toBe(false);
    expect(r.skipReason).toContain("READ_ONLY");
  });

  it("returns empty positions when none exist", () => {
    mockFindAll.mockReturnValue([]);
    const r = listMonitorablePositions("MAINNET_TINY");
    expect(r.ok).toBe(true);
    expect(r.positions).toEqual([]);
  });

  it("filters only OPEN/MONITORING", () => {
    const open = makePosition({ state: "OPEN" });
    const closed = makePosition({ state: "CLOSED" });
    mockFindAll.mockReturnValue([open, closed]);
    const r = listMonitorablePositions("MAINNET_TINY");
    expect(r.ok).toBe(true);
    expect(r.positions).toEqual([open]);
  });
});

describe("evaluateSinglePosition", () => {
  beforeEach(() => {
    mockGetLatestScan.mockReturnValue({ opportunities: [makeOpp({ symbol: "BTC/USDT", funding8h: 0.001 })] });
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ markPrice: 60001 });
  });

  it("returns exit when monitor signals exit", async () => {
    mockMonitorPosition.mockReturnValue({ action: "exit", reason: "funding flipped" });
    const r = await evaluateSinglePosition(makePosition(), "w1", "MAINNET_TINY");
    expect(r.action).toBe("exit");
    expect(r.reason).toContain("funding flipped");
    expect(r.snapshot).toBeDefined();
  });

  it("returns freeze when monitor signals freeze", async () => {
    mockMonitorPosition.mockReturnValue({ action: "freeze", reason: "hard stop" });
    const r = await evaluateSinglePosition(makePosition(), "w1", "MAINNET_TINY");
    expect(r.action).toBe("freeze");
  });

  it("returns hold when monitor signals hold", async () => {
    mockMonitorPosition.mockReturnValue({ action: "hold", reason: "funding positive" });
    const r = await evaluateSinglePosition(makePosition(), "w1", "MAINNET_TINY");
    expect(r.action).toBe("hold");
  });

  it("returns hold on error", async () => {
    mockMonitorPosition.mockImplementation(() => { throw new Error("monitor error"); });
    const r = await evaluateSinglePosition(makePosition(), "w1", "MAINNET_TINY");
    expect(r.action).toBe("hold");
    expect(r.reason).toContain("monitor error");
  });
});

describe("executeMonitorAction", () => {
  beforeEach(() => {
    mockCreateAccountAdapter.mockReturnValue({
      adapter: {
        fetchBalances: mockFetchBalances,
        fetchPositions: mockFetchPositions,
        fetchOpenOrders: mockFetchOpenOrders,
      },
    });
    mockFetchBalances.mockResolvedValue([{ asset: "BTC", free: 0.001 }]);
    mockFetchPositions.mockResolvedValue([{ symbol: "BTC/USDT", side: "perp_short", quantity: 0.001 }]);
    mockFetchOpenOrders.mockResolvedValue([]);
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ ask1: 60001, markPrice: 60000 });
    mockBuildClosePlan.mockResolvedValue(makeClosePlan());
    mockSaveClosePlan.mockResolvedValue(undefined);
  });

  it("calls tryExecuteClose for exit action", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "closed", finalPnlEstimate: { netProfit: 1.5 } });
    const r = await executeMonitorAction(makePosition(), "exit", "exit signal", "w1", "MAINNET_TINY");
    expect(r.action).toBe("close_executed");
    expect(r.ok).toBe(true);
  });

  it("calls tryExecuteClose for freeze action", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "prechecked" });
    const r = await executeMonitorAction(makePosition(), "freeze", "hard stop", "w1", "SHADOW");
    expect(r.action).toBe("close_executed");
    expect(r.ok).toBe(true);
  });

  it("returns hold for hold action", async () => {
    const r = await executeMonitorAction(makePosition(), "hold", "funding positive", "w1", "MAINNET_TINY");
    expect(r.action).toBe("hold");
    expect(r.ok).toBe(true);
    expect(r.message).toBe("funding positive");
  });

  it("returns error when close fails", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "failed", blockers: ["timeout"] });
    const r = await executeMonitorAction(makePosition(), "exit", "exit signal", "w1", "MAINNET_TINY");
    expect(r.action).toBe("error");
    expect(r.ok).toBe(false);
  });
});

describe("fetchCloseExchangeSnapshot", () => {
  beforeEach(() => {
    mockCreateAccountAdapter.mockReturnValue({
      adapter: {
        fetchBalances: mockFetchBalances,
        fetchPositions: mockFetchPositions,
        fetchOpenOrders: mockFetchOpenOrders,
      },
    });
    mockFetchBalances.mockResolvedValue([{ asset: "BTC", free: 0.001 }]);
    mockFetchPositions.mockResolvedValue([{ symbol: "BTC/USDT", side: "perp_short", quantity: 0.001 }]);
    mockFetchOpenOrders.mockResolvedValue([]);
  });

  it("returns snapshot with spot balance and perp position", async () => {
    const r = await fetchCloseExchangeSnapshot("binance", "BTC/USDT");
    expect(r.ok).toBe(true);
    expect(r.snapshot?.spotBalance).toEqual({ asset: "BTC", free: 0.001 });
    expect(r.snapshot?.perpShortPosition).toEqual({ symbol: "BTC/USDT", side: "perp_short", quantity: 0.001 });
    expect(r.snapshot?.openOrders).toEqual([]);
  });

  it("returns blockers on error", async () => {
    mockFetchBalances.mockRejectedValue(new Error("network"));
    const r = await fetchCloseExchangeSnapshot("binance", "BTC/USDT");
    expect(r.ok).toBe(false);
    expect(r.blockers?.[0]).toContain("network");
  });
});

describe("fetchCloseOrderBook", () => {
  it("returns order book for binance", async () => {
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ ask1: 60001, markPrice: 60000 });
    const r = await fetchCloseOrderBook("binance", "BTC/USDT");
    expect(r.ok).toBe(true);
    expect(r.orderBook?.spotBid1).toBe(60000);
    expect(r.orderBook?.perpAsk1).toBe(60001);
    expect(r.orderBook?.markPrice).toBe(60000);
  });

  it("returns empty order book on error", async () => {
    mockFetchTickerSpot.mockRejectedValue(new Error("network"));
    mockFetchTicker.mockRejectedValue(new Error("network"));
    const r = await fetchCloseOrderBook("binance", "BTC/USDT");
    expect(r.ok).toBe(true);
    expect(r.orderBook?.spotBid1).toBe(0);
  });
});

describe("buildAndSaveClosePlan", () => {
  beforeEach(() => {
    mockBuildClosePlan.mockResolvedValue(makeClosePlan());
    mockSaveClosePlan.mockResolvedValue(undefined);
  });

  it("saves validated close plan", async () => {
    const snapshot = { exchange: "binance", spotBalance: null, perpShortPosition: null, openOrders: [], fetchedAtUtc: "" } as any;
    const orderBook = { spotBid1: 60000, spotAsk1: 0, perpBid1: 0, perpAsk1: 60001, markPrice: 60000, fetchedAtUtc: "" };
    const r = await buildAndSaveClosePlan(makePosition(), snapshot, orderBook, "MAINNET_TINY", "normal_tp");
    expect(r.ok).toBe(true);
    expect(r.closePlan).toBeDefined();
    expect(mockSaveClosePlan).toHaveBeenCalled();
  });

  it("returns blockers when invalid", async () => {
    const plan = makeClosePlan({ status: "blocked", blockers: ["qty too small"] });
    mockBuildClosePlan.mockResolvedValue(plan);
    const snapshot = { exchange: "binance", spotBalance: null, perpShortPosition: null, openOrders: [], fetchedAtUtc: "" } as any;
    const orderBook = { spotBid1: 60000, spotAsk1: 0, perpBid1: 0, perpAsk1: 60001, markPrice: 60000, fetchedAtUtc: "" };
    const r = await buildAndSaveClosePlan(makePosition(), snapshot, orderBook, "MAINNET_TINY", "normal_tp");
    expect(r.ok).toBe(false);
    expect(r.blockers).toContain("qty too small");
    expect(mockSaveClosePlan).not.toHaveBeenCalled();
  });
});

describe("submitGuardedClose", () => {
  it("returns success on closed", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "closed", finalPnlEstimate: { netProfit: 2.5 } });
    const r = await submitGuardedClose(makeClosePlan(), "w1", "MAINNET_TINY", "normal_tp", "BTC/USDT");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("平仓成功");
  });

  it("returns success on prechecked", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "prechecked" });
    const r = await submitGuardedClose(makeClosePlan(), "w1", "SHADOW", "normal_tp", "BTC/USDT");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("dry-run");
  });

  it("returns failure on other status", async () => {
    mockExecuteGuardedClose.mockResolvedValue({ status: "failed", blockers: ["timeout"] });
    const r = await submitGuardedClose(makeClosePlan(), "w1", "MAINNET_TINY", "normal_tp", "BTC/USDT");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("timeout");
  });
});

describe("tryAutoEntry integration", () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({ mode: "MAINNET_TINY" });
    mockGetLatestScan.mockReturnValue({ opportunities: [makeOpp()] });
    mockFindAll.mockReturnValue([]);
    mockLoadSettings.mockResolvedValue({ notional: { plannedNotionalUsdt: 10 }, funding: { minFundingRate8h: 0.0005 } });
    mockCanPlaceRealOrders.mockReturnValue(true);
    mockRunSafeExecutionDecision.mockResolvedValue(makeDecision());
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ ask1: 60001 });
    mockBuildTwoLegOrderPlan.mockResolvedValue(makeOrderPlan());
    mockExecuteGuardedTwoLegOrder.mockResolvedValue({ status: "filled", id: "exec-1" });
    mockCreatePaperExecution.mockReturnValue(makePosition({ state: "IDLE" }));
  });

  it("places order when decision is FINAL_AUDIT_READY", async () => {
    const r = await tryAutoEntry("w1");
    expect(r.action).toBe("order_placed");
    expect(r.symbol).toBe("BTC/USDT");
  });

  it("returns blocked when decision is BLOCKED", async () => {
    mockRunSafeExecutionDecision.mockResolvedValue(makeDecision({ state: "BLOCKED", blockers: ["risk"] }));
    const r = await tryAutoEntry("w1");
    expect(r.action).toBe("blocked");
  });

  it("handles TRANSFER_REQUIRED and places order", async () => {
    mockRunSafeExecutionDecision.mockResolvedValue(makeDecision({
      state: "TRANSFER_REQUIRED",
      transferPlan: { exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 10, reason: "margin" },
    }));
    mockExecuteAutoTransferAndReaudit.mockResolvedValue({ ok: true, status: "reaudit_passed", ledgerId: "l1", blockers: [], warnings: [] });
    const r = await tryAutoEntry("w1");
    expect(r.action).toBe("order_placed");
  });

  it("blocks when transfer fails", async () => {
    mockRunSafeExecutionDecision.mockResolvedValue(makeDecision({
      state: "TRANSFER_REQUIRED",
      transferPlan: { exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 10, reason: "margin" },
    }));
    mockExecuteAutoTransferAndReaudit.mockResolvedValue({ ok: false, status: "failed", ledgerId: "l1", blockers: ["insufficient"], warnings: [] });
    const r = await tryAutoEntry("w1");
    expect(r.action).toBe("blocked");
    expect(r.message).toContain("insufficient");
  });
});

describe("tryAutoMonitor integration", () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({ mode: "MAINNET_TINY" });
    mockFindAll.mockReturnValue([makePosition()]);
    mockGetLatestScan.mockReturnValue({ opportunities: [makeOpp({ symbol: "BTC/USDT", funding8h: 0.001 })] });
    mockFetchTickerSpot.mockResolvedValue({ bid1: 60000 });
    mockFetchTicker.mockResolvedValue({ markPrice: 60001 });
    mockMonitorPosition.mockReturnValue({ action: "hold", reason: "funding positive" });
    mockCreateAccountAdapter.mockReturnValue({
      adapter: {
        fetchBalances: mockFetchBalances,
        fetchPositions: mockFetchPositions,
        fetchOpenOrders: mockFetchOpenOrders,
      },
    });
    mockFetchBalances.mockResolvedValue([{ asset: "BTC", free: 0.001 }]);
    mockFetchPositions.mockResolvedValue([{ symbol: "BTC/USDT", side: "perp_short", quantity: 0.001 }]);
    mockFetchOpenOrders.mockResolvedValue([]);
  });

  it("returns hold actions for each position", async () => {
    const r = await tryAutoMonitor("w1");
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].action).toBe("hold");
  });

  it("executes close on exit signal", async () => {
    mockMonitorPosition.mockReturnValue({ action: "exit", reason: "funding flipped" });
    mockBuildClosePlan.mockResolvedValue(makeClosePlan());
    mockSaveClosePlan.mockResolvedValue(undefined);
    mockExecuteGuardedClose.mockResolvedValue({ status: "closed", finalPnlEstimate: { netProfit: 1.5 } });
    const r = await tryAutoMonitor("w1");
    expect(r.actions[0].action).toBe("close_executed");
  });
});
