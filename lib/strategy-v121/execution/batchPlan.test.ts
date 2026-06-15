import { describe, expect, it } from "vitest";
import { createBatchPlan, calcNextBatchAmount } from "./batchPlan";

describe("createBatchPlan", () => {
  it("creates 3 batches with 30/30/40 ratios", () => {
    const plan = createBatchPlan(10000);
    expect(plan.batches).toHaveLength(3);
    expect(plan.batches[0].ratio).toBe(0.3);
    expect(plan.batches[1].ratio).toBe(0.3);
    expect(plan.batches[2].ratio).toBe(0.4);
  });

  it("cumulative targets are correct", () => {
    const plan = createBatchPlan(10000);
    expect(plan.batches[0].cumulativeTarget).toBeCloseTo(0.3);
    expect(plan.batches[1].cumulativeTarget).toBeCloseTo(0.6);
    expect(plan.batches[2].cumulativeTarget).toBeCloseTo(1.0);
  });

  it("target notionals scale with total", () => {
    const plan = createBatchPlan(20000);
    expect(plan.batches[2].targetNotional).toBe(20000);
  });
});

describe("calcNextBatchAmount", () => {
  it("first batch allows full amount", () => {
    const plan = createBatchPlan(10000);
    const r = calcNextBatchAmount(plan, 0, 0);
    expect(r.allowed).toBe(true);
    expect(r.amount).toBe(3000);
  });

  it("second batch accounts for filled", () => {
    const plan = createBatchPlan(10000);
    const r = calcNextBatchAmount(plan, 1, 3000);
    expect(r.allowed).toBe(true);
    expect(r.amount).toBe(3000);
  });

  it("does not exceed total plan", () => {
    const plan = createBatchPlan(10000);
    const r = calcNextBatchAmount(plan, 2, 5000);
    expect(r.allowed).toBe(true);
    expect(r.amount).toBe(5000);
  });
});
