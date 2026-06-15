import { describe, expect, it } from "vitest";
import {
  calcEntryExecutableBasis,
  calcExitExecutableBasis,
  calcRiskMarkBasis,
  calcMidPrice,
  calcSpreadRate,
} from "./basis";

describe("basis calculations", () => {
  it("calcEntryExecutableBasis: perp bid / spot ask - 1", () => {
    // perp bid=100200, spot ask=100000 → 0.002 = 0.2%
    expect(calcEntryExecutableBasis(100200, 100000)).toBeCloseTo(0.002, 6);
  });

  it("calcExitExecutableBasis: perp ask / spot bid - 1", () => {
    // perp ask=100300, spot bid=99900 → ~0.004004 = 0.4%
    expect(calcExitExecutableBasis(100300, 99900)).toBeCloseTo(0.004004, 5);
  });

  it("calcRiskMarkBasis: perp mark / spot mid - 1", () => {
    // perp mark=100150, spot mid=(99900+100100)/2=100000 → 0.0015
    expect(calcRiskMarkBasis(100150, 100000)).toBeCloseTo(0.0015, 5);
  });

  it("entry basis is negative when perp < spot (backwardation)", () => {
    expect(calcEntryExecutableBasis(99000, 100000)).toBeCloseTo(-0.01, 5);
  });

  it("calcMidPrice averages bid and ask", () => {
    expect(calcMidPrice(99, 101)).toBe(100);
  });

  it("calcSpreadRate returns (ask-bid)/mid", () => {
    expect(calcSpreadRate(99.5, 100.5)).toBeCloseTo(0.01, 5); // 1%
  });

  it("returns 0 for invalid inputs", () => {
    expect(calcEntryExecutableBasis(0, 100)).toBe(0);
    expect(calcExitExecutableBasis(100, 0)).toBe(0);
    expect(calcRiskMarkBasis(-1, 100)).toBe(0);
  });
});
