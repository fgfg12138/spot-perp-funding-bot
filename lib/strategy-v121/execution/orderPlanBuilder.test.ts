import { describe, expect, it, vi } from "vitest";
import { buildTwoLegOrderPlan } from "./orderPlanBuilder";

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: vi.fn().mockResolvedValue({
    execution: { maxLegDeviationRate: 0.01 },
    notional: { maxOrderNotionalUsdt: 50 },
    funding: { minFundingRate8h: 0.0005 },
  }),
}));

const baseInput = {
  intentId: "intent-test-123",
  exchange: "binance" as const,
  symbol: "BTC/USDT",
  plannedNotionalUsdt: 10,
  latestSpotPrice: 60000,
  latestPerpPrice: 60001,
  spotConstraints: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, tickSize: 0.01 },
  perpConstraints: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, tickSize: 0.01 },
};

describe("buildTwoLegOrderPlan", () => {
  it("1. normal spot_buy + perp_short with correct clientOrderIds", async () => {
    const plan = await buildTwoLegOrderPlan(baseInput);
    expect(plan.status).toBe("validated");
    expect(plan.spotLeg.role).toBe("spot_buy");
    expect(plan.perpLeg.role).toBe("perp_short");
    expect(plan.spotLeg.clientOrderId).toContain("v121_spot_");
    expect(plan.perpLeg.clientOrderId).toContain("v121_perp_");
    expect(plan.spotLeg.clientOrderId.length).toBeLessThanOrEqual(36);
    expect(plan.perpLeg.clientOrderId.length).toBeLessThanOrEqual(36);
    expect(plan.blockers).toHaveLength(0);
  });

  it("2. stepSize rounding works", async () => {
    const plan = await buildTwoLegOrderPlan({
      ...baseInput,
      plannedNotionalUsdt: 10,
      spotConstraints: { ...baseInput.spotConstraints, stepSize: 0.01 },
      perpConstraints: { ...baseInput.perpConstraints, stepSize: 0.1 },
    });
    const rawQty = 10 / 60000; // ≈ 0.0001667
    expect(plan.spotLeg.quantity).toBeLessThan(rawQty); // floored, not rounded
    expect(plan.perpLeg.quantity).toBeLessThan(rawQty); // floored
  });

  it("3. minNotional not met → blocked", async () => {
    const plan = await buildTwoLegOrderPlan({
      ...baseInput,
      plannedNotionalUsdt: 1, // too small
      spotConstraints: { ...baseInput.spotConstraints, minNotional: 100 },
      perpConstraints: { ...baseInput.perpConstraints, minNotional: 100 },
    });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.length).toBeGreaterThan(0);
  });

  it("4. leg deviation > maxLegDeviationRate → blocked", async () => {
    const plan = await buildTwoLegOrderPlan({
      ...baseInput,
      latestSpotPrice: 60000,
      latestPerpPrice: 30000, // 50% deviation
    });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.some((b: string) => b.includes("deviation"))).toBe(true);
  });

  it("5. clientOrderId ≤ 36 chars", async () => {
    const plan = await buildTwoLegOrderPlan(baseInput);
    expect(plan.spotLeg.clientOrderId.length).toBeLessThanOrEqual(36);
    expect(plan.perpLeg.clientOrderId.length).toBeLessThanOrEqual(36);
  });

  it("6. allowedForActualOrder is false even on success", async () => {
    const plan = await buildTwoLegOrderPlan(baseInput);
    expect(plan.status).toBe("validated");
    expect(plan.allowedForActualOrder).toBe(false);
  });
});
