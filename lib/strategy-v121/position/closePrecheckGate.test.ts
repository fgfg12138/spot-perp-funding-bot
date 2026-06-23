import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runClosePrecheckGate } from "./closePrecheckGate";
import type { PaperExecution } from "../execution/paperLifecycle";
import type { ExchangeAccountSnapshot, CloseOrderBook } from "./closeExecutionTypes";
import type { AccountBalanceSnapshot, AccountPositionSnapshot } from "../account/accountTypes";

function makePosition(overrides: Partial<PaperExecution> & { state?: PaperExecution["state"] } = {}): PaperExecution {
  return {
    id: "pos-1",
    state: "OPEN",
    plan: { batches: [] } as any,
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
    ...overrides,
  } as PaperExecution;
}

function makeSpotBalance(free = 0.001): AccountBalanceSnapshot {
  return {
    exchange: "binance",
    asset: "BTC",
    free,
    locked: 0,
    total: free,
    fetchedAtUtc: new Date().toISOString(),
  };
}

function makePerpShort(qty = 0.001, symbol = "BTC/USDT"): AccountPositionSnapshot {
  return {
    exchange: "binance",
    symbol,
    marketType: "perp",
    side: "perp_short",
    quantity: qty,
    notionalUsdt: qty * 50000,
    entryPrice: 50100,
    markPrice: 50050,
    unrealizedPnlUsdt: 0,
    fetchedAtUtc: new Date().toISOString(),
  };
}

function makeSnapshot(overrides: Partial<ExchangeAccountSnapshot> = {}): ExchangeAccountSnapshot {
  return {
    exchange: "binance",
    spotBalance: makeSpotBalance(),
    perpShortPosition: makePerpShort(),
    openOrders: [],
    fetchedAtUtc: new Date().toISOString(),
    ...overrides,
  };
}

describe("closePrecheckGate", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.V121_KILL_SWITCH;
    delete process.env.V121_ENABLE_REAL_CLOSE_EXECUTION;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("passes for a healthy Binance same-exchange OPEN position", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
    });
    expect(result.ok).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks when position state is not closeable (CLOSED)", () => {
    const result = runClosePrecheckGate({
      position: makePosition({ state: "CLOSED" }),
      exchangeSnapshot: makeSnapshot(),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("not closeable"))).toBe(true);
  });

  it("blocks OKX spot exchange (not_supported)", () => {
    const result = runClosePrecheckGate({
      position: makePosition({
        path: { symbol: "BTC/USDT", spotExchange: "okx", perpExchange: "binance", isCrossExchange: true },
      }),
      exchangeSnapshot: makeSnapshot(),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("okx"))).toBe(true);
  });

  it("blocks cross-exchange close", () => {
    const result = runClosePrecheckGate({
      position: makePosition({
        path: { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: true },
      }),
      exchangeSnapshot: makeSnapshot(),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("cross-exchange"))).toBe(true);
  });

  it("blocks when no perp short position on exchange", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot({ perpShortPosition: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("no perp short"))).toBe(true);
  });

  it("blocks when no spot balance to sell", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot({ spotBalance: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("no spot balance"))).toBe(true);
  });

  it("blocks on PAUSE_ALL_AUTOMATION kill switch", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      killSwitch: "PAUSE_ALL_AUTOMATION",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("PAUSE_ALL_AUTOMATION"))).toBe(true);
  });

  it("allows close under PAUSE_NEW_ENTRIES (EXIT still permitted)", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      killSwitch: "PAUSE_NEW_ENTRIES",
    });
    expect(result.ok).toBe(true);
  });

  it("blocks READ_ONLY_ONLY kill switch", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      killSwitch: "READ_ONLY_ONLY",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("READ_ONLY_ONLY"))).toBe(true);
  });

  it("level2 freeze blocks all close", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      freezeLevel: "level2",
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("level2"))).toBe(true);
  });

  it("level1 freeze blocks normal_tp but allows hard_stop_loss", () => {
    const tpResult = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      freezeLevel: "level1",
      triggerReason: "normal_tp",
    });
    expect(tpResult.ok).toBe(false);
    expect(tpResult.blockers.some((b) => b.includes("normal_tp blocked"))).toBe(true);

    const hslResult = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      freezeLevel: "level1",
      triggerReason: "hard_stop_loss",
    });
    expect(hslResult.ok).toBe(true);
  });

  it("level1 freeze allows margin_risk and manual", () => {
    for (const trigger of ["margin_risk", "manual"] as const) {
      const result = runClosePrecheckGate({
        position: makePosition(),
        exchangeSnapshot: makeSnapshot(),
        freezeLevel: "level1",
        triggerReason: trigger,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("warns on open orders for same symbol (not a blocker)", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot({
        openOrders: [
          {
            exchange: "binance",
            symbol: "BTC/USDT",
            marketType: "perp",
            side: "buy",
            price: 50000,
            quantity: 0.001,
            filledQuantity: 0,
            status: "open",
            fetchedAtUtc: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("open orders"))).toBe(true);
  });

  it("realCloseEnabled checks V121_ENABLE_REAL_CLOSE_EXECUTION env", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      realCloseEnabled: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("V121_ENABLE_REAL_CLOSE_EXECUTION"))).toBe(true);

    process.env.V121_ENABLE_REAL_CLOSE_EXECUTION = "1";
    const result2 = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      realCloseEnabled: true,
    });
    expect(result2.ok).toBe(true);
  });

  it("blocks on symbol mismatch between system record and exchange", () => {
    const result = runClosePrecheckGate({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot({ perpShortPosition: makePerpShort(0.001, "ETH/USDT") }),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("symbol mismatch"))).toBe(true);
  });
});
