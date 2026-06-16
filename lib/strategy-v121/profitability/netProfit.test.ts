import { describe, expect, it } from "vitest";
import { calcNetProfit, calcFundingDecay } from "./netProfit";
import type { NetProfitInput } from "./netProfit";

const baseInput: NetProfitInput = {
  path: { spotExchange: "binance", perpExchange: "binance" },
  entryBasis: 0.006,
  expectedExitBasis: 0.001,
  funding8h: 0.001,
  fundingCycles: 2,
  secondsToNextFunding: 3600,
  plannedNotional: 10000,
  makerRate: 0.0002,
  takerRate: 0.0007,
  isTakerEntry: false,
  spotSlippage: 0.0005,
  perpSlippage: 0.0005,
  phase: "tiny",
};

describe("calcNetProfit", () => {
  it("profitable Binance same-exchange path passes", () => {
    const r = calcNetProfit(baseInput);
    expect(r.passed).toBe(true);
    expect(r.expectedNetRate).toBeGreaterThanOrEqual(r.minRequiredRate);
    expect(r.expectedNetProfit).toBeGreaterThanOrEqual(r.minRequiredProfit);
  });

  it("low basis fails threshold", () => {
    const r = calcNetProfit({ ...baseInput, entryBasis: 0.002 });
    expect(r.passed).toBe(false);
  });

  it("HTX path has higher minimum rate", () => {
    const r = calcNetProfit({ ...baseInput, path: { spotExchange: "htx", perpExchange: "htx" } });
    expect(r.minRequiredRate).toBe(0.006);
  });

  it("Binance↔HTX cross has 0.70% minimum", () => {
    const r = calcNetProfit({ ...baseInput, path: { spotExchange: "binance", perpExchange: "htx" } });
    expect(r.minRequiredRate).toBe(0.007);
  });

  it("Taker mode has higher fee cost", () => {
    const maker = calcNetProfit({ ...baseInput, isTakerEntry: false });
    const taker = calcNetProfit({ ...baseInput, isTakerEntry: true });
    expect(taker.feeCost).toBeGreaterThan(maker.feeCost);
    expect(taker.expectedNetRate).toBeLessThan(maker.expectedNetRate);
  });

  it("tiny phase minimum profit is 5 USDT", () => {
    const r = calcNetProfit({ ...baseInput, plannedNotional: 500 });
    expect(r.minRequiredProfit).toBe(5);
  });
});

describe("calcFundingDecay", () => {
  it("first cycle near settlement gets 100%", () => {
    const r = calcFundingDecay(0.001, 1, 10 * 60);
    expect(r.decayedFunding).toBeCloseTo(0.001, 6);
  });

  it("first cycle far from settlement gets 40%", () => {
    const r = calcFundingDecay(0.001, 1, 5 * 3600);
    expect(r.decayedFunding).toBeCloseTo(0.0004, 6);
  });

  it("two cycles decay correctly", () => {
    const r = calcFundingDecay(0.001, 2, 3600);
    expect(r.decayedFunding).toBeCloseTo(0.0008 + 0.0005, 6);
  });
});
