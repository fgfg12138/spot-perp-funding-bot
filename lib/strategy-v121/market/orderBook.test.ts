import { describe, expect, it } from "vitest";
import { calcDepthWithinBps, checkSellDepth, checkBuyDepth } from "./orderBook";
import type { OrderBookLevel } from "../domain/types";

function L(price: number, qty: number): OrderBookLevel {
  return { price, qty };
}

describe("calcDepthWithinBps", () => {
  it("calculates depth within 0.3% for asks", () => {
    const levels = [L(100, 10), L(100.2, 20), L(100.5, 30)];
    const r = calcDepthWithinBps(levels, 100, 0.003);
    // 100 * 1.003 = 100.3; first two levels inside
    expect(r.availableNotional).toBeCloseTo(100 * 10 + 100.2 * 20, 0);
    expect(r.levelCount).toBe(2);
  });

  it("returns zero for empty levels", () => {
    const r = calcDepthWithinBps([], 100, 0.003);
    expect(r.availableNotional).toBe(0);
    expect(r.levelCount).toBe(0);
  });
});

describe("checkSellDepth", () => {
  it("passes when depth is sufficient", () => {
    const asks = [L(100, 100)]; // 10000 notional
    const r = checkSellDepth(asks, 100, 1000, 0.003, 3);
    expect(r.passed).toBe(true);
  });

  it("fails when depth is insufficient", () => {
    const asks = [L(100, 1)]; // 100 notional
    const r = checkSellDepth(asks, 100, 1000, 0.003, 3);
    expect(r.passed).toBe(false);
  });
});

describe("checkBuyDepth", () => {
  it("passes when bid depth is sufficient", () => {
    const bids = [L(100, 100)];
    const r = checkBuyDepth(bids, 100, 1000, 0.003, 5);
    expect(r.passed).toBe(true);
  });

  it("fails when bid depth is insufficient", () => {
    const bids = [L(100, 1)];
    const r = checkBuyDepth(bids, 100, 1000, 0.003, 5);
    expect(r.passed).toBe(false);
  });
});
