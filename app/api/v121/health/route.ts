import { NextResponse } from "next/server";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import { evaluateFreezeState } from "@/lib/strategy-v121/health/freezeState";

/**
 * GET /api/v121/health — system health and mode status
 */
export async function GET() {
  const config = getConfig();

  const freeze = evaluateFreezeState({
    wsOk: true, restOk: true, timeSyncMs: 100, wsLatencyMs: 500,
    orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: config.maxDataAgeMs,
  });

  return NextResponse.json({
    mode: config.mode,
    modeLabel: config.mode === "READ_ONLY" ? "只读" : config.mode === "PAPER" ? "纸面交易" : config.mode,
    health: {
      timeSyncMs: 100, wsLatencyMs: 500, restOk: true, wsOk: true,
      dataFreshnessMs: 1000, isHealthy: freeze.level === "none",
    },
    freeze: {
      level: freeze.level, reason: freeze.reason,
      allowedActions: freeze.allowedActions,
      prohibitedActions: freeze.prohibitedActions,
    },
    opportunityCount: 0,
    openPositionCount: 0,
    todayPnl: 0,
  });
}
