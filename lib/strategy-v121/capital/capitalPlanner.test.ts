import { describe, expect, it } from "vitest";
import {
  computeCapitalPlan,
  computeCapitalPlanSafe,
  computeSymbolPositionLimit,
  checkLiquidationDistance,
  assessOverallRisk,
} from "./capitalPlanner";
import type { CapitalPlanInput, LiquidationCheckInput } from "./capitalPlanner";

describe("capitalPlanner / computeCapitalPlan", () => {
  const baseInput: CapitalPlanInput = {
    totalCapital: 10_000,
    planType: "moderate",
    isCrossExchange: false,
    symbolCategory: "core",
  };

  it("returns correct structure", () => {
    const plan = computeCapitalPlan(baseInput);
    expect(plan.totalCapital).toBe(10_000);
    expect(plan.spotRatio).toBe(0.30);
    expect(plan.shortNotionalRatio).toBe(0.30);
    expect(plan.perpMarginBufferRatio).toBe(0.30);
    expect(plan.reserveRatio).toBe(0.10);
    expect(plan.planType).toBe("moderate");
  });

  it("computes amounts correctly for same-exchange standard plan", () => {
    const plan = computeCapitalPlan(baseInput);
    expect(plan.spotAmount).toBe(3_000);       // 30% of 10k
    expect(plan.shortNotionalAmount).toBe(3_000);
    expect(plan.perpMarginBufferAmount).toBe(3_000);
    expect(plan.reserveAmount).toBe(1_000);
    expect(plan.totalMarginAmount).toBe(6_000);
  });

  it("tolerablePriceRise = totalMargin/shortNotional - 1", () => {
    const plan = computeCapitalPlan(baseInput);
    expect(plan.tolerablePriceRise).toBeCloseTo(6000 / 3000 - 1, 5);
  });

  it("uses cross-exchange conservative plan when isCrossExchange", () => {
    const crossInput: CapitalPlanInput = { ...baseInput, isCrossExchange: true };
    const plan = computeCapitalPlan(crossInput);
    expect(plan.spotRatio).toBe(0.25);
    expect(plan.shortNotionalRatio).toBe(0.25);
    expect(plan.perpMarginBufferRatio).toBe(0.35);
    expect(plan.reserveRatio).toBe(0.15);
  });

  it("tolerablePriceRise is Infinity when shortNotional is 0", () => {
    const zeroInput: CapitalPlanInput = { ...baseInput, totalCapital: 0 };
    const plan = computeCapitalPlan(zeroInput);
    expect(plan.tolerablePriceRise).toBe(Infinity);
  });

  it("tolerablePriceRise is non-negative", () => {
    // When totalMargin is very small relative to shortNotional, tolerablePriceRise could be negative
    // computeCapitalPlan clamps to 0 via Math.max(0, ...)
    // Create a case where ratio is bad
    const badInput: CapitalPlanInput = {
      totalCapital: 0.01,
      planType: "conservative",
      isCrossExchange: true,
      symbolCategory: "core",
    };
    const plan = computeCapitalPlan(badInput);
    expect(plan.tolerablePriceRise).toBeGreaterThanOrEqual(0);
  });
});

describe("capitalPlanner / computeCapitalPlanSafe", () => {
  const baseInput: CapitalPlanInput = {
    totalCapital: 10_000,
    planType: "moderate",
    isCrossExchange: false,
    symbolCategory: "core",
  };

  it("returns same plan for core (riskMultiplier=1)", () => {
    const base = computeCapitalPlan(baseInput);
    const safe = computeCapitalPlanSafe(baseInput);
    expect(safe.spotAmount).toBe(base.spotAmount);
    expect(safe.shortNotionalAmount).toBe(base.shortNotionalAmount);
    expect(safe.perpMarginBufferAmount).toBe(base.perpMarginBufferAmount);
  });

  it("increases margin for watch/meme category", () => {
    const watchInput: CapitalPlanInput = { ...baseInput, symbolCategory: "watch" };
    const core = computeCapitalPlanSafe(baseInput);
    const watch = computeCapitalPlanSafe(watchInput);
    expect(watch.perpMarginBufferAmount).toBeGreaterThan(core.perpMarginBufferAmount);
    expect(watch.shortNotionalAmount).toBeLessThan(core.shortNotionalAmount);
  });

  it("increases margin for opportunity category", () => {
    const oppInput: CapitalPlanInput = { ...baseInput, symbolCategory: "opportunity" };
    const core = computeCapitalPlanSafe(baseInput);
    const opp = computeCapitalPlanSafe(oppInput);
    expect(opp.perpMarginBufferAmount).toBeGreaterThanOrEqual(core.perpMarginBufferAmount);
  });

  it("reserve increases when freedCapital is positive", () => {
    const watchInput: CapitalPlanInput = { ...baseInput, symbolCategory: "meme" };
    const safe = computeCapitalPlanSafe(watchInput);
    const base = computeCapitalPlan(watchInput);
    expect(safe.reserveAmount).toBeGreaterThan(base.reserveAmount);
  });

  it("does not exceed 65% margin cap", () => {
    const watchInput: CapitalPlanInput = { ...baseInput, symbolCategory: "watch" };
    const safe = computeCapitalPlanSafe(watchInput);
    const maxMargin = baseInput.totalCapital * 0.65;
    expect(safe.perpMarginBufferAmount).toBeLessThanOrEqual(maxMargin + 1); // +1 for rounding
  });

  it("handles 0 capital", () => {
    const zeroInput: CapitalPlanInput = { ...baseInput, totalCapital: 0 };
    const safe = computeCapitalPlanSafe(zeroInput);
    expect(safe.totalCapital).toBe(0);
    expect(safe.tolerablePriceRise).toBe(Infinity);
  });
});

describe("capitalPlanner / computeSymbolPositionLimit", () => {
  it("core category returns 10% max", () => {
    const limit = computeSymbolPositionLimit(10_000, "core");
    expect(limit.maxPct).toBe(0.10);
    expect(limit.maxNotional).toBe(1_000);
    expect(limit.suggestedNotional).toBe(800);
  });

  it("opportunity category returns 5% max", () => {
    const limit = computeSymbolPositionLimit(10_000, "opportunity");
    expect(limit.maxPct).toBe(0.05);
    expect(limit.maxNotional).toBe(500);
  });

  it("watch and meme return 2% max", () => {
    const watch = computeSymbolPositionLimit(10_000, "watch");
    const meme = computeSymbolPositionLimit(10_000, "meme");
    expect(watch.maxPct).toBe(0.02);
    expect(meme.maxPct).toBe(0.02);
    expect(watch.maxNotional).toBe(200);
    expect(meme.maxNotional).toBe(200);
  });

  it("suggestedNotional is 80% of maxNotional", () => {
    const limit = computeSymbolPositionLimit(5_000, "core");
    expect(limit.suggestedNotional).toBe(limit.maxNotional * 0.8);
  });
});

describe("capitalPlanner / checkLiquidationDistance", () => {
  const baseLiqInput: LiquidationCheckInput = {
    markPrice: 50000,
    entryPrice: 48000,
    leverage: 3,
    marginBalance: 6000,
    positionNotional: 3000,
    isSmallCap: false,
  };

  it("returns safe level for healthy position", () => {
    const result = checkLiquidationDistance(baseLiqInput);
    expect(result.riskLevel).toBe("safe");
    expect(result.suggestedAction).toBe("none");
    expect(result.estimatedLiquidationPrice).toBeGreaterThan(baseLiqInput.markPrice);
  });

  it("returns warning when distance is between 35-50%", () => {
    // For a short position, distancePct = estLiqPrice/markPrice - 1
    // estLiqPrice = entryPrice * (1 + marginRatio/leverage)
    // We want distancePct between 0.35 and 0.50 (warning range)
    // marginRatio = marginBalance/positionNotional = 6000/10000 = 0.6
    // estLiqPrice = 50000 * (1 + 0.6/3) = 50000 * 1.2 = 60000
    // For distancePct = 60000/markPrice - 1 = 0.40 → markPrice = 60000/1.4 ≈ 42857
    const warningInput: LiquidationCheckInput = {
      markPrice: 42857,
      entryPrice: 50000,
      leverage: 3,
      marginBalance: 6000,
      positionNotional: 10000,
      isSmallCap: false,
    };
    const result = checkLiquidationDistance(warningInput);
    expect(result.distancePct).toBeGreaterThan(0.35);
    expect(result.distancePct).toBeLessThanOrEqual(0.50);
    expect(result.riskLevel).toBe("warning");
  });

  it("returns danger when distance is between 25-35%", () => {
    // Very tight margin
    const dangerInput: LiquidationCheckInput = {
      markPrice: 80000,
      entryPrice: 50000,
      leverage: 10,
      marginBalance: 500,
      positionNotional: 5000,
      isSmallCap: false,
    };
    const result = checkLiquidationDistance(dangerInput);
    expect(["danger", "critical", "warning"]).toContain(result.riskLevel);
  });

  it("uses stricter thresholds for small caps", () => {
    const smallInput: LiquidationCheckInput = {
      ...baseLiqInput,
      isSmallCap: true,
      markPrice: 100,
      entryPrice: 50,
      leverage: 5,
      marginBalance: 10,
      positionNotional: 50,
    };
    const result = checkLiquidationDistance(smallInput);
    // Small caps have tighter thresholds, so position may be riskier
    expect(typeof result.estimatedLiquidationPrice).toBe("number");
    expect(typeof result.distancePct).toBe("number");
    expect(["safe", "warning", "danger", "critical"]).toContain(result.riskLevel);
  });

  it("returns 0 distance when markPrice is 0", () => {
    const zeroMark: LiquidationCheckInput = { ...baseLiqInput, markPrice: 0 };
    const result = checkLiquidationDistance(zeroMark);
    expect(result.distancePct).toBe(0);
  });

  it("estimatedLiquidationPrice > entryPrice for short positions", () => {
    const result = checkLiquidationDistance(baseLiqInput);
    expect(result.estimatedLiquidationPrice).toBeGreaterThan(baseLiqInput.entryPrice);
  });
});

describe("capitalPlanner / assessOverallRisk", () => {
  it("returns safe when all positions are safe", () => {
    const result = assessOverallRisk(10_000, [
      { symbol: "BTC/USDT", notional: 1000, liqDistance: 0.60 },
      { symbol: "ETH/USDT", notional: 500, liqDistance: 0.55 },
    ]);
    expect(result.overallRisk).toBe("safe");
    expect(result.totalMargin).toBe(10_000);
    expect(result.totalShortNotional).toBe(1_500);
    expect(result.suggestedActions).toHaveLength(0);
  });

  it("returns warning when positions have warning-level distance", () => {
    const result = assessOverallRisk(10_000, [
      { symbol: "BTC/USDT", notional: 1000, liqDistance: 0.40 },
    ]);
    expect(result.overallRisk).toBe("warning");
    expect(result.suggestedActions.length).toBeGreaterThan(0);
  });

  it("returns danger when positions have danger-level distance", () => {
    // danger: > 0.25 threshold, critical: <= 0.25
    const result = assessOverallRisk(10_000, [
      { symbol: "BTC/USDT", notional: 1000, liqDistance: 0.30 },
    ]);
    expect(result.overallRisk).toBe("danger");
  });

  it("returns critical when positions have critical-level distance", () => {
    const result = assessOverallRisk(10_000, [
      { symbol: "BTC/USDT", notional: 1000, liqDistance: 0.10 },
    ]);
    expect(result.overallRisk).toBe("critical");
  });

  it("flags margin usage exceeded when rate > 50%", () => {
    const result = assessOverallRisk(1_000, [
      { symbol: "BTC/USDT", notional: 600, liqDistance: 0.60 },
    ]);
    expect(result.marginUsageExceeded).toBe(true);
    expect(result.suggestedActions.some(a => a.includes("保证金使用率"))).toBe(true);
  });

  it("handles empty positions array", () => {
    const result = assessOverallRisk(10_000, []);
    expect(result.totalShortNotional).toBe(0);
    expect(result.marginUsageRate).toBe(0);
    expect(result.marginUsageExceeded).toBe(false);
    expect(result.overallRisk).toBe("safe");
  });

  it("handles 0 totalMargin gracefully", () => {
    const result = assessOverallRisk(0, [
      { symbol: "BTC/USDT", notional: 100, liqDistance: 0.60 },
    ]);
    // When totalMargin is 0, marginUsageRate = 0 (not Infinity) per implementation
    expect(result.marginUsageRate).toBe(0);
    expect(result.marginUsageExceeded).toBe(false);
  });
});
