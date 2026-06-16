import { NextResponse } from "next/server";
import { getRunState, getHeartbeat } from "@/lib/strategy-v121/worker/runState";
import { readHeartbeats } from "@/lib/strategy-v121/worker/heartbeat";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";

/**
 * GET /api/v121/worker — Worker status and heartbeats
 */
export async function GET() {
  const config = getConfig();
  const state = getRunState();
  const heartbeats = readHeartbeats();
  const latest = heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;

  return NextResponse.json({
    workerId: latest?.workerId ?? "not-started",
    state,
    mode: config.mode,
    lastCycleAtUtc: latest?.lastCycleAtUtc ?? 0,
    cycleCount: latest?.cycleCount ?? 0,
    lastError: latest?.lastError ?? null,
    heartbeats: heartbeats.slice(-10),
  });
}
