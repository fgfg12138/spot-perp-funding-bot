import { NextResponse } from "next/server";
import { refreshAndScan } from "@/lib/strategy-v121/market/marketRefreshService";
import { saveLatestScan } from "@/lib/strategy-v121/opportunity/opportunityStore";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";

/** POST /api/v121/opportunities/scan — 手动触发一次真实行情扫描 */
export async function POST() {
  const config = getConfig();
  const start = Date.now();

  try {
    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate,
      takerRate: config.takerRate,
      isTakerEntry: false,
      systemHealthy: true,
    });
    const durationMs = Date.now() - start;
    const scan = result.scanResult!;

    const rejectSummary: Record<string, number> = {};
    for (const opp of scan.opportunities) {
      for (const r of opp.rejectReasons) {
        rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
      }
    }

    saveLatestScan({
      opportunities: scan.opportunities,
      totalPaths: scan.totalPaths,
      passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount,
      rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: "real_market",
      scannedAtUtc: scan.scannedAtUtc,
      durationMs,
      symbolsScanned: 10,
      exchangesScanned: 3,
    });

    return NextResponse.json({
      opportunities: scan.opportunities,
      total: scan.totalPaths,
      passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount,
      rejectSummary,
      errors: result.errors,
      dataSource: "real_market",
      scannedAtUtc: scan.scannedAtUtc,
      durationMs,
      mode: config.mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "扫描失败", detail: String(err) },
      { status: 500 },
    );
  }
}
