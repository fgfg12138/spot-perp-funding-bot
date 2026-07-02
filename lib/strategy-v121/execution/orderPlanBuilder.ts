import type { ExchangeId } from "../domain/types";
import type { TwoLegOrderPlan, PlannedOrderLeg, OrderPlanStatus } from "./orderTypes";

function makeId(): string { return `oplan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

function sanitizeIntentId(raw?: string): string {
  if (!raw) return "manual";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
}

function makeClientOrderId(input: { prefix: "v121"; role: "spot" | "perp"; intentId?: string; timestampMs: number }): string {
  const intentPart = sanitizeIntentId(input.intentId);
  return `${input.prefix}_${input.role}_${intentPart}_${input.timestampMs}`.slice(0, 36);
}

function floorToStep(value: number, stepSize?: number): number {
  if (!stepSize || stepSize <= 0) return value;
  return Math.floor(value / stepSize) * stepSize;
}

export async function buildTwoLegOrderPlan(input: {
  intentId?: string;
  decisionId?: string;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  latestSpotPrice: number;
  latestPerpPrice: number;
  spotConstraints: { minQty?: number; stepSize?: number; minNotional?: number; tickSize?: number };
  perpConstraints: { minQty?: number; stepSize?: number; minNotional?: number; tickSize?: number };
}): Promise<TwoLegOrderPlan> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const ts = Date.now();
  const id = makeId();

  // Load settings
  let maxLegDeviationRate = 0.01;
  let maxOrderNotionalUsdt = 50;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    const s = await loadSettings();
    maxLegDeviationRate = s.execution.maxLegDeviationRate ?? 0.01;
    maxOrderNotionalUsdt = s.notional.maxOrderNotionalUsdt ?? 50;
  } catch { /* defaults */ }

  // Compute raw quantities
  const rawSpotQty = input.plannedNotionalUsdt / input.latestSpotPrice;
  const rawPerpQty = input.plannedNotionalUsdt / input.latestPerpPrice;

  // Floor to step
  const spotQty = floorToStep(rawSpotQty, input.spotConstraints.stepSize);
  const perpQty = floorToStep(rawPerpQty, input.perpConstraints.stepSize);

  // Recompute notionals
  const spotNotional = spotQty * input.latestSpotPrice;
  const perpNotional = perpQty * input.latestPerpPrice;

  // Validations
  if (spotQty <= 0) blockers.push("spot qty <= 0 after step rounding");
  if (perpQty <= 0) blockers.push("perp qty <= 0 after step rounding");

  const spotMinNotional = input.spotConstraints.minNotional ?? 0;
  const perpMinNotional = input.perpConstraints.minNotional ?? 0;
  if (spotNotional < spotMinNotional) blockers.push(`spot notional ${spotNotional.toFixed(2)} < minNotional ${spotMinNotional.toFixed(2)}`);
  if (perpNotional < perpMinNotional) blockers.push(`perp notional ${perpNotional.toFixed(2)} < minNotional ${perpMinNotional.toFixed(2)}`);

  const legDeviationRate = Math.abs(spotNotional - perpNotional) / Math.max(spotNotional, perpNotional, 0.0001);
  if (legDeviationRate > maxLegDeviationRate) {
    blockers.push(`leg deviation ${(legDeviationRate * 100).toFixed(2)}% > max ${(maxLegDeviationRate * 100).toFixed(2)}%`);
  }

  const actualNotional = Math.max(spotNotional, perpNotional);
  if (actualNotional > maxOrderNotionalUsdt) {
    blockers.push(`actual notional ${actualNotional.toFixed(2)} > max ${maxOrderNotionalUsdt.toFixed(2)}`);
  }

  const status: OrderPlanStatus = blockers.length === 0 ? "validated" : "blocked";

  const spotLeg: PlannedOrderLeg = {
    role: "spot_buy", exchange: input.exchange, symbol: input.symbol,
    market: "spot", side: "BUY", type: "MARKET",
    quantity: spotQty, quoteNotionalUsdt: spotNotional,
    estimatedPrice: input.latestSpotPrice,
    clientOrderId: makeClientOrderId({ prefix: "v121", role: "spot", intentId: input.intentId, timestampMs: ts }),
    reduceOnly: false,
    constraints: input.spotConstraints,
  };

  const perpLeg: PlannedOrderLeg = {
    role: "perp_short", exchange: input.exchange, symbol: input.symbol,
    market: "perp", side: "SELL", type: "MARKET",
    quantity: perpQty, quoteNotionalUsdt: perpNotional,
    estimatedPrice: input.latestPerpPrice,
    clientOrderId: makeClientOrderId({ prefix: "v121", role: "perp", intentId: input.intentId, timestampMs: ts + 1 }),
    reduceOnly: false, positionSide: "SHORT",
    constraints: input.perpConstraints,
  };

  return {
    id, intentId: input.intentId, decisionId: input.decisionId,
    exchange: input.exchange, symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt,
    spotLeg, perpLeg,
    status, blockers, warnings,
    createdAtUtc: now,
    expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    allowedForActualOrder: false,
  };
}
