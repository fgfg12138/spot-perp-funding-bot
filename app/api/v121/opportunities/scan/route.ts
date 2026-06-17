import { NextResponse } from "next/server";

/** POST /api/v121/opportunities/scan */
export async function POST() {
  try {
    const { getConfig } = await import("@/lib/strategy-v121/config/strategyConfig");
    const { refreshAndScan } = await import("@/lib/strategy-v121/market/marketRefreshService");
    const { saveLatestScan } = await import("@/lib/strategy-v121/opportunity/opportunityStore");

    const config = getConfig();
    const t0 = Date.now();
    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate, takerRate: config.takerRate,
      isTakerEntry: false, systemHealthy: true,
    });
    const elapsed = Date.now() - t0;

    const scan = result.scanResult;
    if (!scan) {
      return NextResponse.json({
        ok: false, error: "scanResult 为空",
        errors: result.errors.map(e => `${e.exchange}/${e.symbol}: ${e.error}`),
        elapsedMs: elapsed,
      }, { status: 500 });
    }

    const rejectSummary: Record<string, number> = {};
    for (const opp of scan.opportunities) {
      for (const r of opp.rejectReasons) rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
    }

    try {
      saveLatestScan({
        opportunities: scan.opportunities, totalPaths: scan.totalPaths,
        passedCount: scan.passedCount, rejectedCount: scan.rejectedCount,
        rejectSummary,
        errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
        dataSource: result.errors.length === 0 ? "real_market" : "real_market_with_errors",
        scannedAtUtc: scan.scannedAtUtc || Date.now(),
        durationMs: elapsed,
        symbolsScanned: 5, exchangesScanned: 3,
      });
    } catch (saveErr: any) {
      return NextResponse.json({
        ok: false, error: "保存扫描结果失败", detail: saveErr.message,
        scannedOk: true, elapsedMs: elapsed,
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      opportunities: scan.opportunities,
      total: scan.totalPaths, passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount, rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: result.errors.length === 0 ? "real_market" : "real_market_with_errors",
      scannedAtUtc: scan.scannedAtUtc || Date.now(), elapsedMs: elapsed,
      mode: config.mode,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message || String(err),
      name: err.name || "Error",
      stack: process.env.NODE_ENV === "development" ? String(err.stack).split("\n").slice(0, 3) : undefined,
    }, { status: 500 });
  }
}
