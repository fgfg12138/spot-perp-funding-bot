/**
 * 平仓方案持久化 — close_plan_ledger 表。
 *
 * 与 close_execution_ledger 拆开：方案可被生成多次但不一定执行，
 * 执行记录必须可追踪订单状态。/review 据此区分"平仓方案"与"平仓执行"。
 */
import type { ClosePlan } from "./closeExecutionTypes";
import { getRepository } from "../persistence/repositoryFactory";

const T = "close_plan_ledger";

function normalize(row: any): ClosePlan {
  const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : {};
  return {
    id: row.id,
    positionId: row.position_id,
    exchange: row.exchange,
    symbol: row.symbol,
    perpLeg: raw.perpLeg,
    spotLeg: raw.spotLeg,
    status: row.status,
    blockers: raw.blockers ?? [],
    warnings: raw.warnings ?? [],
    systemRecordQty: raw.systemRecordQty ?? { spot: 0, perp: 0 },
    exchangeActualQty: raw.exchangeActualQty ?? { spot: 0, perp: 0 },
    closeQty: raw.closeQty ?? { spot: 0, perp: 0 },
    createdAtUtc: row.created_at_utc,
    expiresAtUtc: row.expires_at_utc,
    realCloseEnabled: row.real_close_enabled === 1 || row.real_close_enabled === true,
  };
}

export async function saveClosePlan(plan: ClosePlan): Promise<void> {
  const repo = getRepository();
  repo.save(T, {
    id: plan.id,
    position_id: plan.positionId,
    exchange: plan.exchange,
    symbol: plan.symbol,
    spot_close_qty: plan.closeQty.spot,
    perp_close_qty: plan.closeQty.perp,
    status: plan.status,
    blockers_json: JSON.stringify(plan.blockers),
    warnings_json: JSON.stringify(plan.warnings),
    real_close_enabled: plan.realCloseEnabled ? 1 : 0,
    raw_json: JSON.stringify(plan),
    created_at_utc: plan.createdAtUtc,
    expires_at_utc: plan.expiresAtUtc,
    updated_at_utc: new Date().toISOString(),
  } as any);
}

export async function findClosePlanById(id: string): Promise<ClosePlan | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  const found = rows.find((r: any) => r.id === id);
  return found ? normalize(found) : null;
}

export async function listRecentClosePlans(limit = 20): Promise<ClosePlan[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows
    .sort((a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime())
    .slice(0, limit)
    .map(normalize);
}

export async function listClosePlansByPositionId(positionId: string): Promise<ClosePlan[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows
    .filter((r: any) => r.position_id === positionId)
    .sort((a, b) => new Date(b.created_at_utc).getTime() - new Date(a.created_at_utc).getTime())
    .map(normalize);
}
