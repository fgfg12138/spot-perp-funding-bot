import type { TwoLegOrderPlan } from "./orderTypes";
import { BaseLedgerStore } from "../persistence/baseLedgerStore";

interface OrderPlanLedgerRow {
  id: string;
  intent_id?: string | null;
  decision_id?: string | null;
  exchange: string;
  symbol: string;
  planned_notional_usdt?: number;
  status: string;
  allowed_for_actual_order?: number;
  raw_json?: string;
  created_at_utc?: string;
  expires_at_utc?: string;
  updated_at_utc?: string;
}

export class OrderPlanLedgerStore extends BaseLedgerStore<TwoLegOrderPlan> {
  constructor() {
    super("order_plan_ledger");
  }

  private parse(raw: OrderPlanLedgerRow): TwoLegOrderPlan {
    const data = typeof raw.raw_json === "string" ? JSON.parse(raw.raw_json) : raw;
    return { ...data, allowedForActualOrder: false as const };
  }

  /** 覆写 findById 以应用 parse */
  findById(id: string): TwoLegOrderPlan | undefined {
    const raw = super.findById(id) as unknown as OrderPlanLedgerRow | undefined;
    return raw ? this.parse(raw) : undefined;
  }

  savePlan(plan: TwoLegOrderPlan): void {
    this.repo.save(this.tableName, {
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
    });
  }

  listRecentPlans(limit = 20): TwoLegOrderPlan[] {
    const all = this.findAll() as unknown as OrderPlanLedgerRow[];
    return all
      .sort((a, b) => new Date(b.created_at_utc ?? 0).getTime() - new Date(a.created_at_utc ?? 0).getTime())
      .slice(0, limit)
      .map((raw) => this.parse(raw));
  }
}

// 导出单例
export const orderPlanLedgerStore = new OrderPlanLedgerStore();

// ─── 兼容旧 API 的函数包装 ──────────────────────────

export function saveOrderPlan(plan: TwoLegOrderPlan): void {
  orderPlanLedgerStore.savePlan(plan);
}

export function findOrderPlanById(id: string): Promise<TwoLegOrderPlan | null> {
  return Promise.resolve(orderPlanLedgerStore.findById(id) ?? null);
}

export function listRecentOrderPlans(limit = 20): Promise<TwoLegOrderPlan[]> {
  return Promise.resolve(orderPlanLedgerStore.listRecentPlans(limit));
}
