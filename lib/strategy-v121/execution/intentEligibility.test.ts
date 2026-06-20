import { describe, expect, it } from "vitest";

/**
 * These tests verify the intent validation logic used in the order-plan API route.
 * The actual filtering happens before runPreOrderExecutionGate is called.
 */

function isEligibleRealArbitrageIntent(i: any): boolean {
  return (
    i.purpose === "real_arbitrage" &&
    i.simulationOnly !== true &&
    i.simulationOnly !== 1 &&
    i.simulationOnly !== "1" &&
    i.realTradeEligible === true
  );
}

describe("intent eligibility for order plans", () => {
  it("rehearsal intent is not eligible", () => {
    const intent = { id: "r1", purpose: "execution_rehearsal", simulationOnly: true, realTradeEligible: false };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(false);
  });

  it("simulationOnly=true intent is not eligible", () => {
    const intent = { id: "s1", purpose: "real_arbitrage", simulationOnly: true, realTradeEligible: false };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(false);
  });

  it("realTradeEligible=false intent is not eligible", () => {
    const intent = { id: "re1", purpose: "real_arbitrage", simulationOnly: false, realTradeEligible: false };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(false);
  });

  it("real_arbitrage + simulationOnly=false + realTradeEligible=true is eligible", () => {
    const intent = { id: "ok1", purpose: "real_arbitrage", simulationOnly: false, realTradeEligible: true };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(true);
  });

  it("simulationOnly=1 (number) is not eligible", () => {
    const intent = { id: "n1", purpose: "real_arbitrage", simulationOnly: 1, realTradeEligible: true };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(false);
  });

  it("simulationOnly='1' (string) is not eligible", () => {
    const intent = { id: "str1", purpose: "real_arbitrage", simulationOnly: "1", realTradeEligible: true };
    expect(isEligibleRealArbitrageIntent(intent)).toBe(false);
  });
});
