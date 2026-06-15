import type { FreezeState } from "../domain/types";

export interface FreezeCheckInput {
  wsOk: boolean;
  restOk: boolean;
  timeSyncMs: number;
  wsLatencyMs: number;
  orderStatusUnknown: boolean;
  dataFreshMs: number;
  maxDataAgeMs: number;
}

export function evaluateFreezeState(input: FreezeCheckInput): FreezeState {
  const now = Date.now();

  // 二级冻结条件
  if (!input.restOk || input.orderStatusUnknown || input.timeSyncMs > 1000) {
    return {
      level: "level2",
      triggeredAtUtc: now,
      reason: buildFreezeReason(input, "level2"),
      allowedActions: ["cancel_known_orders", "stop_opening", "alert_human", "wait_recovery"],
      prohibitedActions: ["auto_tp_sl_stale_data", "open_new", "add_position"],
    };
  }

  // 一级冻结条件
  if (!input.wsOk || input.wsLatencyMs > 3000 || input.timeSyncMs > 500 || input.dataFreshMs > input.maxDataAgeMs) {
    return {
      level: "level1",
      triggeredAtUtc: now,
      reason: buildFreezeReason(input, "level1"),
      allowedActions: ["cancel_orders", "query_positions", "rest_price_check", "hard_stop_loss", "margin_risk", "short_leg_repair"],
      prohibitedActions: ["open_new", "add_position", "normal_tp"],
    };
  }

  return { level: "none", triggeredAtUtc: now, reason: "", allowedActions: ["all"], prohibitedActions: [] };
}

function buildFreezeReason(input: FreezeCheckInput, level: string): string {
  const reasons: string[] = [];
  if (!input.restOk) reasons.push("REST异常");
  if (!input.wsOk) reasons.push("WS异常");
  if (input.wsLatencyMs > 3000) reasons.push(`WS延迟${input.wsLatencyMs}ms`);
  if (input.timeSyncMs > 1000) reasons.push(`时间偏差${input.timeSyncMs}ms`);
  if (input.timeSyncMs > 500) reasons.push(`时间偏差${input.timeSyncMs}ms`);
  if (input.orderStatusUnknown) reasons.push("订单状态不可确认");
  if (input.dataFreshMs > input.maxDataAgeMs) reasons.push(`数据过期${Math.floor(input.dataFreshMs / 1000)}s`);
  return `${level === "level2" ? "二级冻结" : "一级冻结"}: ${reasons.join("; ")}`;
}

export function canOpenPosition(freeze: FreezeState): boolean {
  return freeze.level === "none";
}

export function canExecuteRiskAction(freeze: FreezeState): boolean {
  return freeze.level !== "level2";
}
