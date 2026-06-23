import type { ExchangeId } from "../domain/types";

export type OrderLegRole = "spot_buy" | "perp_short" | "spot_sell" | "perp_buy_close";

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
  /** 语义标记：开仓腿为 false，平仓腿为 true。adapter 按持仓模式转换。 */
  reduceOnly: boolean;
  positionSide?: "SHORT" | "LONG" | "BOTH";
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
