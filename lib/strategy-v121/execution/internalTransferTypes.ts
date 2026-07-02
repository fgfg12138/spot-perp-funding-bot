import type { ExchangeId } from "../domain/types";

export type InternalTransferAccount = "spot" | "perp";

export type InternalTransferStatus =
  | "planned"
  | "dry_run"
  | "submitted"
  | "balance_confirmed"
  | "reaudit_passed"
  | "failed"
  | "frozen";

export interface InternalTransferRequest {
  exchange: ExchangeId;
  asset: "USDT";
  fromAccount: InternalTransferAccount;
  toAccount: InternalTransferAccount;
  amountUsdt: number;
  reason: string;
  intentId?: string;
  decisionId?: string;
  idempotencyKey: string;
  dryRun: boolean;
}

export interface InternalTransferResult {
  ok: boolean;
  status: InternalTransferStatus;
  exchange: ExchangeId;
  asset: "USDT";
  fromAccount: InternalTransferAccount;
  toAccount: InternalTransferAccount;
  amountUsdt: number;
  idempotencyKey: string;
  transferId?: string;
  submittedAtUtc?: string;
  confirmedAtUtc?: string;
  error?: string;
  warnings: string[];
  raw?: unknown;
}

export interface InternalTransferLedgerRecord {
  id: string;
  intentId?: string;
  decisionId?: string;
  exchange: ExchangeId;
  asset: "USDT";
  fromAccount: InternalTransferAccount;
  toAccount: InternalTransferAccount;
  amountUsdt: number;
  status: InternalTransferStatus;
  idempotencyKey: string;
  transferId?: string;
  error?: string;
  exchangeTransferType?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  rawJson?: string;
}
