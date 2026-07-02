import { describe, expect, it } from "vitest";
import { arbitrateRisk } from "./riskArbiter";
import type { RiskArbiterInput } from "./riskArbiter";

const healthy: RiskArbiterInput = {
  spotNotional: 1000, perpNotional: 1000,
  comboLoss: 0, totalEquity: 10000, peakEquity: 10000,
  adlLevel: "low", depthDeclinePercent: 0, spreadChangeRatio: 1,
  phase: "tiny",
};

describe("arbitrateRisk", () => {
  it("healthy state returns none", () => {
    const r = arbitrateRisk(healthy);
    expect(r.action).toBe("none");
    expect(r.priority).toBe(10);
  });

  it(">5% deviation is emergency", () => {
    const r = arbitrateRisk({ ...healthy, spotNotional: 1000, perpNotional: 1100 });
    expect(r.action).toBe("emergency");
    expect(r.reason.severity).toBe("critical");
  });

  it("stop loss triggers exit", () => {
    const r = arbitrateRisk({ ...healthy, comboLoss: 25, totalEquity: 10000 });
    expect(r.action).toBe("exit");
  });

  it("ADL high triggers exit", () => {
    const r = arbitrateRisk({ ...healthy, adlLevel: "high" });
    expect(r.action).toBe("exit");
  });

  it("ADL medium blocks add position", () => {
    const r = arbitrateRisk({ ...healthy, adlLevel: "medium" });
    expect(r.action).toBe("reduce");
  });

  it("70% depth decline triggers exit", () => {
    const r = arbitrateRisk({ ...healthy, depthDeclinePercent: 0.75 });
    expect(r.action).toBe("exit");
  });

  it("3x spread triggers reduce", () => {
    const r = arbitrateRisk({ ...healthy, spreadChangeRatio: 3.5 });
    expect(r.action).toBe("reduce");
  });
});
