/**
 * 平仓执行持久化 — close_execution_ledger 表。
 *
 * 与 close_plan_ledger 拆开：执行记录追踪真实订单状态、保护状态、收益。
 * 每次执行前先写一行（status=prechecked, ok=false），提交后逐步更新。
 * 遵循 guardedOrderExecutor 的 ledger-before-submission 模式。
 */
import type { CloseExecutionResult, CloseExecutionStatus } from "./closeExecutionTypes";
import type { ExchangeId } from "../domain/types";
import { getRepository } from "../persistence/repositoryFactory";

const T = "close_execution_ledger";

interface CloseExecutionLedgerRow {
  id: string;
  position_id: string;
  close_plan_id: string;
  exchange: string;
  symbol: string;
  status: string;
  perp_client_order_id?: string | null;
  perp_exchange_order_id?: string | null;
  perp_status?: string | null;
  spot_client_order_id?: string | null;
  spot_exchange_order_id?: string | null;
  spot_status?: string | null;
  frozen_reason?: string | null;
  final_pnl_json?: string;
  verification_json?: string;
  raw_json?: string;
  created_at_utc?: string;
  updated_at_utc?: string;
}

function normalize(row: CloseExecutionLedgerRow): CloseExecutionResult {
  const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : {};
  return {
    ok: row.status === "closed",
    id: row.id,
    positionId: row.position_id,
    closePlanId: row.close_plan_id,
    exchange: row.exchange as ExchangeId,
    symbol: row.symbol,
    status: row.status as CloseExecutionStatus,
    perpCloseOrder: raw.perpCloseOrder,
    spotCloseOrder: raw.spotCloseOrder,
    blockers: raw.blockers ?? [],
    warnings: raw.warnings ?? [],
    frozenReason: row.frozen_reason ?? undefined,
    finalPnlEstimate: raw.finalPnlEstimate,
    verification: raw.verification,
    createdAtUtc: row.created_at_utc ?? "",
    updatedAtUtc: row.updated_at_utc ?? "",
  };
}

export async function saveCloseExecution(result: CloseExecutionResult): Promise<void> {
  const repo = getRepository();
  repo.save(T, {
    id: result.id,
    position_id: result.positionId,
    close_plan_id: result.closePlanId,
    exchange: result.exchange,
    symbol: result.symbol,
    status: result.status,
    perp_client_order_id: result.perpCloseOrder?.clientOrderId ?? null,
    perp_exchange_order_id: result.perpCloseOrder?.exchangeOrderId ?? null,
    perp_status: result.perpCloseOrder?.status ?? null,
    spot_client_order_id: result.spotCloseOrder?.clientOrderId ?? null,
    spot_exchange_order_id: result.spotCloseOrder?.exchangeOrderId ?? null,
    spot_status: result.spotCloseOrder?.status ?? null,
    frozen_reason: result.frozenReason ?? null,
    final_pnl_json: result.finalPnlEstimate ? JSON.stringify(result.finalPnlEstimate) : null,
    verification_json: result.verification ? JSON.stringify(result.verification) : null,
    raw_json: JSON.stringify(result),
    created_at_utc: result.createdAtUtc,
    updated_at_utc: result.updatedAtUtc,
  });
}

export async function updateCloseExecution(
  id: string,
  patch: Partial<CloseExecutionResult>,
): Promise<void> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as unknown as CloseExecutionLedgerRow[];
  const existing = rows.find((r) => r.id === id);
  if (!existing) return;
  const merged: CloseExecutionLedgerRow & Record<string, unknown> = {
    ...existing,
    ...patch,
    updated_at_utc: new Date().toISOString(),
  };
  if (patch.perpCloseOrder) {
    merged.perp_client_order_id = patch.perpCloseOrder.clientOrderId;
    merged.perp_exchange_order_id = patch.perpCloseOrder.exchangeOrderId ?? null;
    merged.perp_status = patch.perpCloseOrder.status;
  }
  if (patch.spotCloseOrder) {
    merged.spot_client_order_id = patch.spotCloseOrder.clientOrderId;
    merged.spot_exchange_order_id = patch.spotCloseOrder.exchangeOrderId ?? null;
    merged.spot_status = patch.spotCloseOrder.status;
  }
  if (patch.frozenReason) merged.frozen_reason = patch.frozenReason;
  if (patch.finalPnlEstimate) merged.final_pnl_json = JSON.stringify(patch.finalPnlEstimate);
  if (patch.verification) merged.verification_json = JSON.stringify(patch.verification);
  merged.raw_json = JSON.stringify(merged);
  repo.save(T, merged);
}

export async function findCloseExecutionById(id: string): Promise<CloseExecutionResult | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as unknown as CloseExecutionLedgerRow[];
  const found = rows.find((r) => r.id === id);
  return found ? normalize(found) : null;
}

export async function listRecentCloseExecutions(limit = 20): Promise<CloseExecutionResult[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as unknown as CloseExecutionLedgerRow[];
  return rows
    .sort((a, b) => new Date(b.created_at_utc ?? 0).getTime() - new Date(a.created_at_utc ?? 0).getTime())
    .slice(0, limit)
    .map(normalize);
}

export async function listCloseExecutionsByPositionId(
  positionId: string,
): Promise<CloseExecutionResult[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as unknown as CloseExecutionLedgerRow[];
  return rows
    .filter((r) => r.position_id === positionId)
    .sort((a, b) => new Date(b.created_at_utc ?? 0).getTime() - new Date(a.created_at_utc ?? 0).getTime())
    .map(normalize);
}
