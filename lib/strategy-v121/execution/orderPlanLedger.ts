import type { TwoLegOrderPlan } from "./orderTypes";
import { getRepository } from "../persistence/repositoryFactory";

const T = "order_plan_ledger";

function parse(raw: any): TwoLegOrderPlan {
  const data = typeof raw.raw_json === "string" ? JSON.parse(raw.raw_json) : raw;
  return { ...data, allowedForActualOrder: false as const };
}

export async function saveOrderPlan(plan: TwoLegOrderPlan): Promise<void> {
  const repo = getRepository();
  repo.save(T, {
    id: plan.id,
    intent_id: plan.intentId ?? null,
    decision_id: plan.decisionId ?? null,
    exchange: plan.exchange,
    symbol: plan.symbol,
    planned_notional_usdt: plan.plannedNotionalUsdt,
    status: plan.status,
    allowed_for_actual_order: 0,
    raw_json: JSON.stringify(plan),
    created_at_utc: plan.createdAtUtc,
    expires_at_utc: plan.expiresAtUtc,
    updated_at_utc: plan.createdAtUtc,
  } as any);
}

export async function findOrderPlanById(id: string): Promise<TwoLegOrderPlan | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  const found = rows.find((r: any) => r.id === id);
  return found ? parse(found) : null;
}

export async function listRecentOrderPlans(limit = 20): Promise<TwoLegOrderPlan[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows
    .sort((a, b) => new Date(b.created_at_utc ?? 0).getTime() - new Date(a.created_at_utc ?? 0).getTime())
    .slice(0, limit)
    .map(parse);
}
