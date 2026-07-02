import { NextResponse } from "next/server";
import { getKillSwitch } from "@/lib/strategy-v121/risk/killSwitch";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";
import { evaluateFreezeState } from "@/lib/strategy-v121/health/freezeState";

/**
 * GET /api/v121/risk — real-time risk status
 */
export async function GET() {
  const ks = getKillSwitch();
  const config = getConfig();
  const executions = paperStore.findAll();

  const frozen = executions.filter(e => e.state === "FROZEN");
  const deviations = executions
    .filter(e => e.positionDeviation > 0.01)
    .map(e => ({ id: e.id, deviation: e.positionDeviation }));

  const freeze = evaluateFreezeState({
    wsOk: true, restOk: true, timeSyncMs: 100, wsLatencyMs: 500,
    orderStatusUnknown: frozen.length > 0,
    dataFreshMs: 1000, maxDataAgeMs: 10000,
  });

  return NextResponse.json({
    killSwitch: ks,
    freezeLevel: freeze.level,
    freezeReason: freeze.reason || null,
    mode: config.mode,
    openExecutionCount: executions.filter(
      e => !["CLOSED", "FAILED"].includes(e.state),
    ).length,
    frozenCount: frozen.length,
    deviationCount: deviations.length,
    deviations,
    canTrade: ks === "OFF" && freeze.level === "none",
    allowedActions: freeze.allowedActions,
    prohibitedActions: freeze.prohibitedActions,
  });
}
