import { describe, it, expect } from "vitest";
import { buildClosePlan } from "./closePlanBuilder";
import type { PaperExecution } from "../execution/paperLifecycle";
import type { ExchangeAccountSnapshot, CloseOrderBook } from "./closeExecutionTypes";
import type { AccountBalanceSnapshot, AccountPositionSnapshot } from "../account/accountTypes";

function makePosition(overrides: Partial<PaperExecution> = {}): PaperExecution {
  return {
    id: "pos-1",
    state: "OPEN",
    plan: { batches: [] } as any,
    path: { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: false },
    spotFilledQty: 0.001,
    perpFilledQty: 0.001,
    spotAvgPrice: 50000,
    perpAvgPrice: 50100,
    spotNotional: 50,
    perpNotional: 50,
    actualBasis: 0.002,
    positionDeviation: 0,
    createdAtUtc: Date.now(),
    updatedAtUtc: Date.now(),
    logs: [],
    ...overrides,
  } as PaperExecution;
}

function makeSpotBalance(free = 0.001): AccountBalanceSnapshot {
  return {
    exchange: "binance",
    asset: "BTC",
    free,
    locked: 0,
    total: free,
    fetchedAtUtc: new Date().toISOString(),
  };
}

function makePerpShort(qty = 0.001): AccountPositionSnapshot {
  return {
    exchange: "binance",
    symbol: "BTC/USDT",
    marketType: "perp",
    side: "perp_short",
    quantity: qty,
    notionalUsdt: qty * 50000,
    entryPrice: 50100,
    markPrice: 50050,
    unrealizedPnlUsdt: 0,
    fetchedAtUtc: new Date().toISOString(),
  };
}

function makeSnapshot(overrides: Partial<ExchangeAccountSnapshot> = {}): ExchangeAccountSnapshot {
  return {
    exchange: "binance",
    spotBalance: makeSpotBalance(),
    perpShortPosition: makePerpShort(),
    openOrders: [],
    fetchedAtUtc: new Date().toISOString(),
    ...overrides,
  };
}

function makeOrderBook(): CloseOrderBook {
  return {
    spotBid1: 50000,
    spotAsk1: 50010,
    perpBid1: 50090,
    perpAsk1: 50100,
    markPrice: 50050,
    fetchedAtUtc: new Date().toISOString(),
  };
}

const defaultConstraints = {
  spot: { minQty: 0.0001, stepSize: 0.0001, minNotional: 10 },
  perp: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
};

describe("closePlanBuilder", () => {
  it("uses min(system, exchange) as closeable qty when both equal", async () => {
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.001, perpFilledQty: 0.001 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0.001),
        perpShortPosition: makePerpShort(0.001),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.status).toBe("validated");
    expect(plan.systemRecordQty).toEqual({ spot: 0.001, perp: 0.001 });
    expect(plan.exchangeActualQty).toEqual({ spot: 0.001, perp: 0.001 });
    expect(plan.closeQty).toEqual({ spot: 0.001, perp: 0.001 });
  });

  it("uses exchange actual when system record > exchange (partially closed manually)", async () => {
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.002, perpFilledQty: 0.002 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0.001),
        perpShortPosition: makePerpShort(0.001),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    // closeable = min(0.002, 0.001) = 0.001
    expect(plan.closeQty).toEqual({ spot: 0.001, perp: 0.001 });
    expect(plan.status).toBe("validated");
    // should warn about qty difference
    expect(plan.warnings.some((w) => w.includes("differs"))).toBe(true);
  });

  it("uses system record when system < exchange (only close what we opened)", async () => {
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.001, perpFilledQty: 0.001 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0.005),
        perpShortPosition: makePerpShort(0.005),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    // closeable = min(0.001, 0.005) = 0.001
    expect(plan.closeQty).toEqual({ spot: 0.001, perp: 0.001 });
    expect(plan.warnings.some((w) => w.includes("differs"))).toBe(true);
  });

  it("blocks when exchange actual is 0 (no position/balance on exchange)", async () => {
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.001, perpFilledQty: 0.001 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0),
        perpShortPosition: makePerpShort(0),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.some((b) => b.includes("spot close qty <= 0"))).toBe(true);
    expect(plan.blockers.some((b) => b.includes("perp close qty <= 0"))).toBe(true);
  });

  it("floors close qty to stepSize", async () => {
    // system=0.00123, exchange=0.00123, step=0.001 → floor to 0.001
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.00123, perpFilledQty: 0.00123 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0.00123),
        perpShortPosition: makePerpShort(0.00123),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: { minQty: 0.0001, stepSize: 0.001, minNotional: 10 },
      perpConstraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
      realCloseEnabled: false,
    });
    expect(plan.closeQty).toEqual({ spot: 0.001, perp: 0.001 });
  });

  it("blocks when close notional < minNotional after rounding", async () => {
    // qty 0.0001 × price 50000 = 5 USDT < spot minNotional 10
    const plan = await buildClosePlan({
      position: makePosition({ spotFilledQty: 0.0001, perpFilledQty: 0.001 }),
      exchangeSnapshot: makeSnapshot({
        spotBalance: makeSpotBalance(0.0001),
        perpShortPosition: makePerpShort(0.001),
      }),
      orderBook: makeOrderBook(),
      spotConstraints: { minQty: 0.0001, stepSize: 0.0001, minNotional: 10 },
      perpConstraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
      realCloseEnabled: false,
    });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.some((b) => b.includes("spot close notional"))).toBe(true);
  });

  it("constructs perp leg as BUY close-short with reduceOnly + positionSide SHORT", async () => {
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.perpLeg.role).toBe("perp_buy_close");
    expect(plan.perpLeg.side).toBe("BUY");
    expect(plan.perpLeg.market).toBe("perp");
    expect(plan.perpLeg.reduceOnly).toBe(true);
    expect(plan.perpLeg.positionSide).toBe("SHORT");
    expect(plan.perpLeg.type).toBe("MARKET");
  });

  it("constructs spot leg as SELL with reduceOnly (no positionSide)", async () => {
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.spotLeg.role).toBe("spot_sell");
    expect(plan.spotLeg.side).toBe("SELL");
    expect(plan.spotLeg.market).toBe("spot");
    expect(plan.spotLeg.reduceOnly).toBe(true);
    expect(plan.spotLeg.positionSide).toBeUndefined();
  });

  it("uses spot bid1 for sell estimate, perp ask1 for buy-close estimate", async () => {
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: { ...makeOrderBook(), spotBid1: 49900, perpAsk1: 50200 },
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.spotLeg.estimatedPrice).toBe(49900);
    expect(plan.perpLeg.estimatedPrice).toBe(50200);
    expect(plan.spotLeg.quoteNotionalUsdt).toBeCloseTo(0.001 * 49900, 2);
    expect(plan.perpLeg.quoteNotionalUsdt).toBeCloseTo(0.001 * 50200, 2);
  });

  it("falls back to markPrice when perp ask1 missing", async () => {
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: { ...makeOrderBook(), perpAsk1: 0, markPrice: 50050 },
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(plan.perpLeg.estimatedPrice).toBe(50050);
  });

  it("generates unique clientOrderId for each leg with v121c prefix", async () => {
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
      intentId: "test1234",
    });
    expect(plan.perpLeg.clientOrderId.startsWith("v121c_perp_")).toBe(true);
    expect(plan.spotLeg.clientOrderId.startsWith("v121c_spot_")).toBe(true);
    expect(plan.perpLeg.clientOrderId).not.toBe(plan.spotLeg.clientOrderId);
  });

  it("sets 60s TTL expiry", async () => {
    const before = Date.now();
    const plan = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    const expires = new Date(plan.expiresAtUtc).getTime();
    expect(expires - before).toBeGreaterThan(59_000);
    expect(expires - before).toBeLessThanOrEqual(61_000);
  });

  it("propagates realCloseEnabled flag from input", async () => {
    const planDisabled = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: false,
    });
    expect(planDisabled.realCloseEnabled).toBe(false);

    const planEnabled = await buildClosePlan({
      position: makePosition(),
      exchangeSnapshot: makeSnapshot(),
      orderBook: makeOrderBook(),
      spotConstraints: defaultConstraints.spot,
      perpConstraints: defaultConstraints.perp,
      realCloseEnabled: true,
    });
    expect(planEnabled.realCloseEnabled).toBe(true);
  });
});
