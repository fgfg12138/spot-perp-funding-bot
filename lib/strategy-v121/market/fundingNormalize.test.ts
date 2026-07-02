import { describe, expect, it } from "vitest";
import { normalizeFunding8h, classifyFundingLevel } from "./fundingNormalize";

describe("normalizeFunding8h", () => {
  it("1h interval: multiplies by 8", () => {
    expect(normalizeFunding8h(0.0001, 1)).toBeCloseTo(0.0008, 6);
  });

  it("4h interval: multiplies by 2", () => {
    expect(normalizeFunding8h(0.0001, 4)).toBeCloseTo(0.0002, 6);
  });

  it("8h interval: stays same", () => {
    expect(normalizeFunding8h(0.0001, 8)).toBeCloseTo(0.0001, 6);
  });

  it("zero interval returns original", () => {
    expect(normalizeFunding8h(0.0001, 0)).toBeCloseTo(0.0001, 6);
  });
});

describe("classifyFundingLevel", () => {
  it("0.03% is normal", () => {
    expect(classifyFundingLevel(0.0003).level).toBe("normal");
    expect(classifyFundingLevel(0.0003).canOpen).toBe(true);
  });

  it("0.15% is elevated", () => {
    expect(classifyFundingLevel(0.0015).level).toBe("elevated");
    expect(classifyFundingLevel(0.0015).canOpen).toBe(true);
  });

  it("0.40% is abnormal (no auto)", () => {
    expect(classifyFundingLevel(0.004).level).toBe("abnormal");
    expect(classifyFundingLevel(0.004).canOpen).toBe(false);
  });

  it("0.80% is extreme", () => {
    expect(classifyFundingLevel(0.008).level).toBe("extreme");
    expect(classifyFundingLevel(0.008).canOpen).toBe(false);
  });

  it("2% is blacklist", () => {
    expect(classifyFundingLevel(0.02).level).toBe("blacklist");
  });
});
