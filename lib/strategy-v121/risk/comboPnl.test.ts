import { describe, expect, it } from "vitest";
import { calcComboPnl, checkHardStopLoss, checkDrawdown } from "./comboPnl";

describe("calcComboPnl", () => {
  it("profitable position", () => {
    const r = calcComboPnl({
      spotEntryAvgPrice: 100, spotQty: 10, spotExitVwapNow: 101,
      perpEntryAvgPrice: 101, perpQty: 10, perpMarkPrice: 100, contractMultiplier: 1,
      realizedFunding: 5, feesPaid: 2, slippageCost: 1, otherCost: 0,
    });
    expect(r.spotUnrealizedPnl).toBe(10);
    expect(r.perpUnrealizedPnl).toBe(10);
    expect(r.comboNetPnl).toBe(22);
    expect(r.comboLoss).toBe(0);
  });

  it("losing position", () => {
    const r = calcComboPnl({
      spotEntryAvgPrice: 100, spotQty: 10, spotExitVwapNow: 99,
      perpEntryAvgPrice: 101, perpQty: 10, perpMarkPrice: 102, contractMultiplier: 1,
      realizedFunding: 2, feesPaid: 2, slippageCost: 1, otherCost: 0,
    });
    expect(r.comboNetPnl).toBe(-21);
    expect(r.comboLoss).toBe(21);
  });
});

describe("checkHardStopLoss", () => {
  it("triggers at 0.2% in test phase", () => {
    const r = checkHardStopLoss(20, 10000, "tiny");
    expect(r.triggered).toBe(true);
  });

  it("does not trigger below threshold", () => {
    const r = checkHardStopLoss(10, 10000, "tiny");
    expect(r.triggered).toBe(false);
  });
});

describe("checkDrawdown", () => {
  it("3% draws down halves positions", () => {
    const r = checkDrawdown(10000, 9700);
    expect(r.action).toContain("仓位减半");
  });

  it("10% drawdown clears positions", () => {
    const r = checkDrawdown(10000, 8900);
    expect(r.action).toContain("清空");
  });
});
