import type { StrategyMode, HealthStatus, FreezeState } from "../domain/types";
import { evaluateFreezeState } from "../health/freezeState";

export interface DashboardStatus {
  mode: StrategyMode;
  health: HealthStatus;
  freeze: FreezeState;
  opportunityCount: number;
  openPositionCount: number;
  todayPnl: number;
  modeLabel: string;
}

export function getDashboardStatus(mode: StrategyMode): DashboardStatus {
  const freezeInput = {
    wsOk: true, restOk: true, timeSyncMs: 100, wsLatencyMs: 500,
    orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 10000,
  };
  const freeze = evaluateFreezeState(freezeInput);

  return {
    mode,
    health: {
      timeSyncMs: 100, wsLatencyMs: 500, restOk: true, wsOk: true,
      dataFreshnessMs: 1000, isHealthy: freeze.level === "none",
    },
    freeze,
    opportunityCount: 0,
    openPositionCount: 0,
    todayPnl: 0,
    modeLabel: mode === "READ_ONLY" ? "只读" : mode === "PAPER" ? "纸面交易" : mode,
  };
}
