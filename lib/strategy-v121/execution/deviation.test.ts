import { describe, expect, it } from "vitest";
import { calcPositionDeviation, evaluateDeviation, canProceedToNextBatch } from "./deviation";

describe("calcPositionDeviation", () => {
  it("zero deviation when equal", () => {
    expect(calcPositionDeviation(1000, 1000)).toBe(0);
  });

  it("0.5% when 1005 vs 1000", () => {
    const d = calcPositionDeviation(1005, 1000);
    expect(d).toBeCloseTo(0.004975, 4);
  });

  it("zero when both zero", () => {
    expect(calcPositionDeviation(0, 0)).toBe(0);
  });
});

describe("evaluateDeviation", () => {
  it("<=1% is normal", () => {
    expect(evaluateDeviation(0.008).level).toBe("normal");
  });

  it("1-3% is repair", () => {
    expect(evaluateDeviation(0.02).level).toBe("repair");
  });

  it("3-5% is pause", () => {
    expect(evaluateDeviation(0.04).level).toBe("pause");
  });

  it(">5% is emergency", () => {
    expect(evaluateDeviation(0.06).level).toBe("emergency");
  });
});

describe("canProceedToNextBatch", () => {
  it("allows when deviation <= 1%", () => {
    expect(canProceedToNextBatch(0.005)).toBe(true);
  });

  it("blocks when deviation > 1%", () => {
    expect(canProceedToNextBatch(0.015)).toBe(false);
  });
});
