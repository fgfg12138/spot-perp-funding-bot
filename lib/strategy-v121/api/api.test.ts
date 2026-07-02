import { describe, expect, it } from "vitest";
import { getDashboardStatus } from "./dashboardService";
import { initPaperExecution, executeBatch } from "./executionService";
import type { BatchExecutionState } from "../domain/types";

describe("api / dashboardService", () => {
  it("getDashboardStatus returns READ_ONLY mode", () => {
    const status = getDashboardStatus("READ_ONLY");
    expect(status.mode).toBe("READ_ONLY");
    expect(status.modeLabel).toBe("只读");
    expect(status.opportunityCount).toBe(0);
    expect(status.openPositionCount).toBe(0);
    expect(status.todayPnl).toBe(0);
    expect(typeof status.health.isHealthy).toBe("boolean");
  });

  it("getDashboardStatus returns PAPER mode", () => {
    const status = getDashboardStatus("PAPER");
    expect(status.mode).toBe("PAPER");
    expect(status.modeLabel).toBe("纸面交易");
  });

  it("getDashboardStatus returns SHADOW mode", () => {
    const status = getDashboardStatus("SHADOW");
    expect(status.mode).toBe("SHADOW");
    expect(status.modeLabel).toBe("SHADOW");
  });

  it("getDashboardStatus returns MAINNET_TINY mode", () => {
    const status = getDashboardStatus("MAINNET_TINY");
    expect(status.mode).toBe("MAINNET_TINY");
  });

  it("getDashboardStatus freeze level is none when healthy", () => {
    const status = getDashboardStatus("READ_ONLY");
    expect(status.freeze.level).toBe("none");
  });
});

describe("api / executionService", () => {
  it("initPaperExecution creates a valid plan", () => {
    const result = initPaperExecution({
      symbol: "BTC/USDT",
      spotExchange: "binance",
      perpExchange: "binance",
      totalNotional: 1000,
    });
    expect(result.canExecute).toBe(true);
    expect(result.plan.totalNotional).toBe(1000);
    expect(result.plan.batches).toHaveLength(3);
    expect(result.state.currentBatch).toBe(1);
    expect(result.state.state).toBe("pending");
  });

  it("initPaperExecution batch ratios sum to 1", () => {
    const result = initPaperExecution({
      symbol: "ETH/USDT",
      spotExchange: "binance",
      perpExchange: "okx",
      totalNotional: 5000,
    });
    const sum = result.plan.batches.reduce((s, b) => s + b.ratio, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("executeBatch fills a batch", () => {
    const { state } = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1000,
    });
    const result = executeBatch(state, 1, 50000, 50010, 1);
    expect(result.newState.state).toBe("filled");
    expect(result.newState.currentBatch).toBe(1);
    expect(result.newState.spotFilledQty).toBeGreaterThan(0);
    expect(result.newState.perpFilledQty).toBeGreaterThan(0);
    expect(result.repairNeeded).toBe(false);
  });

  it("executeBatch partial fill marks state as partial", () => {
    const { state } = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1000,
    });
    const result = executeBatch(state, 1, 50000, 50010, 0.5);
    expect(result.newState.state).toBe("partial");
  });

  it("executeBatch zero fill marks state as failed", () => {
    const { state } = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1000,
    });
    const result = executeBatch(state, 1, 50000, 50010, 0);
    expect(result.newState.state).toBe("failed");
  });

  it("executeBatch throws for non-existent batch", () => {
    const { state } = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1000,
    });
    expect(() => executeBatch(state, 99, 50000, 50010, 1)).toThrow();
  });

  it("executeBatch computes actualBasis correctly", () => {
    const { state } = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1000,
    });
    const result = executeBatch(state, 1, 50000, 50100, 1);
    const expectedBasis = 50100 / 50000 - 1;
    expect(result.newState.actualBasis).toBeCloseTo(expectedBasis, 10);
  });
});

describe("api / executionService - edge cases", () => {
  it("handles zero notional gracefully", () => {
    const result = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 0,
    });
    expect(result.plan.totalNotional).toBe(0);
    // batches should still have valid structure
    expect(result.plan.batches.length).toBeGreaterThan(0);
  });

  it("handles large notional", () => {
    const result = initPaperExecution({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", totalNotional: 1_000_000,
    });
    expect(result.plan.totalNotional).toBe(1_000_000);
  });
});
