import { NextResponse } from "next/server";
import { scanOpportunities } from "@/lib/strategy-v121/opportunity/scanner";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import type { MarketSnapshot } from "@/lib/strategy-v121/domain/types";

/**
 * POST /api/v121/opportunities/scan — trigger a fresh opportunity scan
 *
 * Returns scanned opportunities with scores, levels, and reject reasons.
 * Uses empty snapshots in READ_ONLY mode (returns 0 opportunities).
 */
export async function POST() {
  const config = getConfig();

  const output = scanOpportunities({
    spotSnapshots: new Map<string, MarketSnapshot>(),
    perpSnapshots: new Map<string, MarketSnapshot>(),
    systemHealthy: true,
    activeCooldowns: [],
    plannedNotional: config.plannedNotional,
    makerRate: config.makerRate,
    takerRate: config.takerRate,
    isTakerEntry: false,
  });

  return NextResponse.json({
    opportunities: output.opportunities.map(o => ({
      id: o.id,
      symbol: o.path.symbol,
      spotExchange: o.path.spotExchange,
      perpExchange: o.path.perpExchange,
      funding8h: o.funding8h,
      entryBasis: o.entryExecutableBasis,
      score: o.score,
      level: o.level,
      passed: o.passed,
      rejectReasons: o.rejectReasons,
      warnings: o.warnings,
      nextAction: o.nextAction,
    })),
    total: output.totalPaths,
    scannedAtUtc: output.scannedAtUtc,
    passedCount: output.passedCount,
    mode: config.mode,
    note: config.mode === "READ_ONLY"
      ? "只读模式 — 无真实行情快照，扫描结果为空"
      : undefined,
  });
}
