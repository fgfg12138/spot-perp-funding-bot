import { NextResponse } from "next/server";

/** POST /api/v121/opportunities/scan — 手动触发真实行情扫描 */
export async function POST() {
  try {
    const { getConfig } = await import("@/lib/strategy-v121/config/strategyConfig");
    const { refreshAndScan } = await import("@/lib/strategy-v121/market/marketRefreshService");
    const { saveLatestScan } = await import("@/lib/strategy-v121/opportunity/opportunityStore");

    const config = getConfig();
    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate, takerRate: config.takerRate,
      isTakerEntry: false, systemHealthy: true,
    });

    const scan = result.scanResult;
    if (!scan) return NextResponse.json({ error: "扫描器返回空结果" }, { status: 500 });

    const rejectSummary: Record<string, number> = {};
    for (const opp of scan.opportunities) {
      for (const r of opp.rejectReasons) rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
    }

    try { saveLatestScan({
      opportunities: scan.opportunities, totalPaths: scan.totalPaths,
      passedCount: scan.passedCount, rejectedCount: scan.rejectedCount,
      rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: "real_market", scannedAtUtc: scan.scannedAtUtc,
      durationMs: Date.now() - scan.scannedAtUtc + 1000,
      symbolsScanned: 5, exchangesScanned: 3,
    }); } catch { /* best-effort */ }

    return NextResponse.json({
      ok: true, opportunities: scan.opportunities.slice(0, 20),
      total: scan.totalPaths, passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount, rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: "real_market", scannedAtUtc: scan.scannedAtUtc, mode: config.mode,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "扫描失败", detail: err.message ?? String(err) },
      { status: 500 },
    );
  }
}
