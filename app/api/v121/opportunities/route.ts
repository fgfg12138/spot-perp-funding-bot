import { NextResponse } from "next/server";
import { scanOpportunities } from "@/lib/strategy-v121/opportunity/scanner";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import type { MarketSnapshot } from "@/lib/strategy-v121/domain/types";

/**
 * GET /api/v121/opportunities
 *
 * Scans all exchange snapshots and returns opportunity pool.
 * In READ_ONLY mode, returns empty unless market data is available.
 */
export async function GET() {
  try {
    const config = getConfig();

    // In READ_ONLY/PAPER, this will be empty unless real data is provided
    // For now, return empty but with proper structure
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
      opportunities: output.opportunities,
      total: output.totalPaths,
      scannedAtUtc: output.scannedAtUtc,
      passedCount: output.passedCount,
      mode: config.mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "扫描失败", detail: String(err) },
      { status: 500 }
    );
  }
}
