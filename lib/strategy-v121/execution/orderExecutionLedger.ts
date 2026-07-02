import type { TwoLegOrderExecutionResult, OrderExecutionStatus } from "./orderExecutionTypes";
import type { ExchangeId } from "../domain/types";
import { BaseLedgerStore } from "../persistence/baseLedgerStore";

interface OrderExecutionLedgerRow {
  id: string;
  order_plan_id: string;
  exchange: string;
  symbol: string;
  status: string;
  spot_client_order_id?: string | null;
  spot_exchange_order_id?: string | null;
  spot_status?: string | null;
  perp_client_order_id?: string | null;
  perp_exchange_order_id?: string | null;
  perp_status?: string | null;
  frozen_reason?: string | null;
  raw_json?: string;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export class OrderExecutionLedgerStore extends BaseLedgerStore<TwoLegOrderExecutionResult> {
  constructor() {
    super("order_execution_ledger");
  }

  private normalize(row: OrderExecutionLedgerRow): TwoLegOrderExecutionResult {
    const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : {};
    return {
      ok: row.spot_client_order_id ? true : false,
      id: row.id,
      orderPlanId: row.order_plan_id,
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      status: row.status as OrderExecutionStatus,
      blockers: raw.blockers ?? [],
      warnings: raw.warnings ?? [],
      frozenReason: row.frozen_reason ?? undefined,
      spot: raw.spot,
      perp: raw.perp,
      createdAtUtc: row.created_at_utc ?? "",
      updatedAtUtc: row.updated_at_utc ?? "",
    };
  }

  /** 覆写 findById 以应用 normalize */
  findById(id: string): TwoLegOrderExecutionResult | undefined {
    const raw = super.findById(id) as unknown as OrderExecutionLedgerRow | undefined;
    return raw ? this.normalize(raw) : undefined;
  }

  saveExecution(result: TwoLegOrderExecutionResult): void {
    this.repo.save(this.tableName, {
      id: result.id,
      order_plan_id: result.orderPlanId,
      exchange: result.exchange,
      symbol: result.symbol,
      status: result.status,
      spot_client_order_id: result.spot?.clientOrderId ?? null,
      spot_exchange_order_id: result.spot?.exchangeOrderId ?? null,
      spot_status: result.spot?.status ?? null,
      perp_client_order_id: result.perp?.clientOrderId ?? null,
      perp_exchange_order_id: result.perp?.exchangeOrderId ?? null,
      perp_status: result.perp?.status ?? null,
      frozen_reason: result.frozenReason ?? null,
      raw_json: JSON.stringify(result),
      created_at_utc: result.createdAtUtc,
      updated_at_utc: result.updatedAtUtc,
    });
  }

  updateExecution(id: string, patch: Partial<TwoLegOrderExecutionResult>): void {
    const existing = (this.repo.queryAll(this.tableName) as unknown as OrderExecutionLedgerRow[])
      .find((r) => r.id === id);
    if (!existing) return;
    const merged: OrderExecutionLedgerRow & Record<string, unknown> = {
      ...existing,
      ...patch,
      updated_at_utc: new Date().toISOString(),
    };
    if (patch.spot) merged.spot_client_order_id = patch.spot.clientOrderId;
    if (patch.perp) merged.perp_client_order_id = patch.perp.clientOrderId;
    if (patch.frozenReason) merged.frozen_reason = patch.frozenReason;
    merged.raw_json = JSON.stringify(merged);
    this.repo.save(this.tableName, merged);
  }
}

// 导出单例
export const orderExecutionLedgerStore = new OrderExecutionLedgerStore();

// ─── 兼容旧 API 的函数包装 ──────────────────────────

export function saveOrderExecution(result: TwoLegOrderExecutionResult): void {
  orderExecutionLedgerStore.saveExecution(result);
}

export function updateOrderExecution(id: string, patch: Partial<TwoLegOrderExecutionResult>): void {
  orderExecutionLedgerStore.updateExecution(id, patch);
}

export function findOrderExecutionById(id: string): Promise<TwoLegOrderExecutionResult | null> {
  return Promise.resolve(orderExecutionLedgerStore.findById(id) ?? null);
}

export function listRecentOrderExecutions(limit = 20): Promise<TwoLegOrderExecutionResult[]> {
  return Promise.resolve(orderExecutionLedgerStore.listRecent(limit));
}
