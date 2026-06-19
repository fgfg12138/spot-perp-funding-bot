import type { ExchangeId } from "../domain/types";

export type OrderLegRole = "spot_buy" | "perp_short";

export type PlannedOrderType = "MARKET" | "LIMIT";

export type OrderPlanStatus =
  | "planned"
  | "validated"
  | "blocked"
  | "stale"
  | "frozen";

export interface PlannedOrderLeg {
  role: OrderLegRole;
  exchange: ExchangeId;
  symbol: string;
  market: "spot" | "perp";
  side: "BUY" | "SELL";
  type: PlannedOrderType;
  quantity: number;
  quoteNotionalUsdt: number;
  estimatedPrice: number;
  clientOrderId: string;
  reduceOnly: false;
  positionSide?: "SHORT";
  constraints: {
    minQty?: number;
    stepSize?: number;
    minNotional?: number;
    tickSize?: number;
  };
}

export interface TwoLegOrderPlan {
  id: string;
  intentId?: string;
  decisionId?: string;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  spotLeg: PlannedOrderLeg;
  perpLeg: PlannedOrderLeg;
  status: OrderPlanStatus;
  blockers: string[];
  warnings: string[];
  createdAtUtc: string;
  expiresAtUtc: string;
  allowedForActualOrder: false;
}
