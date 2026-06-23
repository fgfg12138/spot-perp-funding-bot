import type { ExchangeId } from "../domain/types";
import type { PlannedOrderLeg } from "./orderTypes";

export type OrderExecutionStatus =
  | "dry_run"
  | "submitted_spot"
  | "submitted_perp"
  | "both_submitted"
  | "filled"
  | "partial"
  | "unknown"
  | "frozen"
  | "failed";

export type ExchangeOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN";

export interface ExchangeOrderSubmissionResult {
  ok: boolean;
  exchange: ExchangeId;
  symbol: string;
  market: "spot" | "perp";
  role: "spot_buy" | "perp_short" | "spot_sell" | "perp_buy_close";
  clientOrderId: string;
  exchangeOrderId?: string;
  status: ExchangeOrderStatus;
  executedQty?: number;
  executedQuoteQty?: number;
  avgPrice?: number;
  submittedAtUtc: string;
  error?: string;
  raw?: unknown;
}

export interface TwoLegOrderExecutionRequest {
  orderPlanId: string;
  dryRun: boolean;
  explicitConfirm?: string;
}

export interface TwoLegOrderExecutionResult {
  ok: boolean;
  id: string;
  orderPlanId: string;
  exchange: ExchangeId;
  symbol: string;
  status: OrderExecutionStatus;
  spot?: ExchangeOrderSubmissionResult;
  perp?: ExchangeOrderSubmissionResult;
  blockers: string[];
  warnings: string[];
  frozenReason?: string;
  rawJson?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export function makeFailedSubmission(leg: PlannedOrderLeg, error: string): ExchangeOrderSubmissionResult {
  return {
    ok: false,
    exchange: leg.exchange,
    symbol: leg.symbol,
    market: leg.market,
    role: leg.role,
    clientOrderId: leg.clientOrderId,
    status: "REJECTED",
    submittedAtUtc: new Date().toISOString(),
    error,
  };
}
