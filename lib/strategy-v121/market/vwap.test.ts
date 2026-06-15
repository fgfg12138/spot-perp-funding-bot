import { describe, expect, it } from "vitest";
import { calcBuyVwap, calcSellVwap } from "./vwap";
import type { OrderBookLevel } from "../domain/types";

function level(price: number, qty: number): OrderBookLevel {
  return { price, qty };
}

describe("calcBuyVwap", () => {
  const asks: OrderBookLevel[] = [
    level(100, 10),
    level(101, 20),
    level(102, 30),
  ];

  it("fully fills when notional <= total ask depth", () => {
    const r = calcBuyVwap(asks, 500); // 5 units at 100
    expect(r.isFullyFillable).toBe(true);
    expect(r.filledQty).toBeCloseTo(5, 6);
    expect(r.avgPrice).toBe(100);
  });

  it("partially fills when notional exceeds depth", () => {
    const r = calcBuyVwap(asks, 10000); // needs more depth
    expect(r.isFullyFillable).toBe(false);
  });

  it("walks up the order book for larger notional", () => {
    const r = calcBuyVwap(asks, 2000); // 10 at 100 + ~9.9 at 101
    expect(r.isFullyFillable).toBe(true);
    expect(r.avgPrice).toBeGreaterThan(100);
    expect(r.avgPrice).toBeLessThan(101);
  });

  it("returns zero for empty asks", () => {
    const r = calcBuyVwap([], 100);
    expect(r.avgPrice).toBe(0);
    expect(r.isFullyFillable).toBe(false);
  });
});

describe("calcSellVwap", () => {
  const bids: OrderBookLevel[] = [
    level(100, 10),
    level(99, 20),
    level(98, 30),
  ];

  it("fully fills small qty at best bid", () => {
    const r = calcSellVwap(bids, 5);
    expect(r.isFullyFillable).toBe(true);
    expect(r.avgPrice).toBe(100);
  });

  it("walks down the book for larger qty", () => {
    const r = calcSellVwap(bids, 15); // 10 at 100 + 5 at 99
    expect(r.isFullyFillable).toBe(true);
    expect(r.avgPrice).toBeCloseTo(99.6667, 3);
  });

  it("partially fills when qty exceeds depth", () => {
    const r = calcSellVwap(bids, 100);
    expect(r.isFullyFillable).toBe(false);
    expect(r.filledQty).toBe(60);
  });

  it("returns zero for empty bids", () => {
    const r = calcSellVwap([], 100);
    expect(r.avgPrice).toBe(0);
    expect(r.isFullyFillable).toBe(false);
  });
});
