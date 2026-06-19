import type { TwoLegOrderExecutionResult } from "./orderExecutionTypes";
import { getRepository } from "../persistence/repositoryFactory";

const T = "order_execution_ledger";

function normalize(row: any): TwoLegOrderExecutionResult {
  const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : {};
  return {
    ok: row.spot_client_order_id ? true : false,
    id: row.id,
    orderPlanId: row.order_plan_id,
    exchange: row.exchange,
    symbol: row.symbol,
    status: row.status,
    blockers: raw.blockers ?? [],
    warnings: raw.warnings ?? [],
    frozenReason: row.frozen_reason ?? undefined,
    spot: raw.spot,
    perp: raw.perp,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

export async function saveOrderExecution(result: TwoLegOrderExecutionResult): Promise<void> {
  const repo = getRepository();
  repo.save(T, {
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
  } as any);
}

export async function updateOrderExecution(id: string, patch: Partial<TwoLegOrderExecutionResult>): Promise<void> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  const existing = rows.find((r: any) => r.id === id);
  if (!existing) return;
  const merged: any = { ...existing, ...patch, updated_at_utc: new Date().toISOString() };
  if (patch.spot) merged.spot_client_order_id = patch.spot.clientOrderId;
  if (patch.perp) merged.perp_client_order_id = patch.perp.clientOrderId;
  if (patch.frozenReason) merged.frozen_reason = patch.frozenReason;
  merged.raw_json = JSON.stringify(merged);
  repo.save(T, merged);
}

export async function findOrderExecutionById(id: string): Promise<TwoLegOrderExecutionResult | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  const found = rows.find((r: any) => r.id === id);
  return found ? normalize(found) : null;
}

export async function listRecentOrderExecutions(limit = 20): Promise<TwoLegOrderExecutionResult[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows
    .sort((a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime())
    .slice(0, limit)
    .map(normalize);
}
