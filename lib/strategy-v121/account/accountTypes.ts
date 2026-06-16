import type { ExchangeId } from "../domain/types";

export type AccountPermissionMode = "read_only" | "trade_enabled" | "withdraw_enabled" | "unknown";

export interface AccountBalanceSnapshot {
  exchange: ExchangeId;
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdtValue?: number;
  fetchedAtUtc: string;
}

export interface AccountPositionSnapshot {
  exchange: ExchangeId;
  symbol: string;
  marketType: "spot" | "perp";
  side: "spot_long" | "perp_short" | "none";
  quantity: number;
  notionalUsdt: number;
  entryPrice?: number;
  markPrice?: number;
  unrealizedPnlUsdt?: number;
  marginRatio?: number;
  adlLevel?: "low" | "medium" | "medium_high" | "high" | "unknown";
  fetchedAtUtc: string;
}

export interface OpenOrderSnapshot {
  exchange: ExchangeId;
  symbol: string;
  marketType: "spot" | "perp";
  side: "buy" | "sell" | "short" | "cover";
  price: number;
  quantity: number;
  filledQuantity: number;
  status: "open" | "partially_filled" | "filled" | "cancelled" | "unknown";
  createdAtUtc?: string;
  fetchedAtUtc: string;
}

export interface ShadowAccountReport {
  mode: "SHADOW";
  generatedAtUtc: string;
  balances: AccountBalanceSnapshot[];
  positions: AccountPositionSnapshot[];
  openOrders: OpenOrderSnapshot[];
  warnings: string[];
  canModifyAccount: false;
}

export interface IAccountAdapter {
  readonly exchangeId: ExchangeId;
  fetchBalances(): Promise<AccountBalanceSnapshot[]>;
  fetchPositions(): Promise<AccountPositionSnapshot[]>;
  fetchOpenOrders(): Promise<OpenOrderSnapshot[]>;
  healthCheck(): Promise<boolean>;
}
