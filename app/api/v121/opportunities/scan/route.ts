import { NextResponse } from "next/server";

/** POST /api/v121/opportunities/scan — 手动触发扫描 */
export async function POST() {
  try {
    // 全部动态导入，避免任何模块顶层加载失败导致 HTML 错误页
    const { getConfig } = await import("@/lib/strategy-v121/config/strategyConfig");
    const config = getConfig();

    const marketModule = await import("@/lib/strategy-v121/market/marketRefreshService");
    const storeModule = await import("@/lib/strategy-v121/opportunity/opportunityStore");

    const result = await marketModule.refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate,
      takerRate: config.takerRate,
      isTakerEntry: false,
      systemHealthy: true,
    });

    const scan = result.scanResult;
    if (!scan) {
      return NextResponse.json({ error: "扫描器返回空结果" }, { status: 500 });
    }

    const rejectSummary: Record<string, number> = {};
    for (const opp of scan.opportunities) {
      for (const r of opp.rejectReasons) {
        rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
      }
    }

    try {
      storeModule.saveLatestScan({
        opportunities: scan.opportunities,
        totalPaths: scan.totalPaths,
        passedCount: scan.passedCount,
        rejectedCount: scan.rejectedCount,
        rejectSummary,
        errors: result.errors.map((e: any) => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
        dataSource: "real_market",
        scannedAtUtc: scan.scannedAtUtc,
        durationMs: Date.now() - (scan.scannedAtUtc || Date.now()) + 1000,
        symbolsScanned: 5,
        exchangesScanned: 3,
      });
    } catch { /* save is best-effort */ }

    return NextResponse.json({
      ok: true,
      opportunities: scan.opportunities,
      total: scan.totalPaths,
      passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount,
      rejectSummary,
      errors: result.errors.map((e: any) => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: "real_market",
      scannedAtUtc: scan.scannedAtUtc,
      durationMs: Date.now() - (scan.scannedAtUtc || Date.now()) + 1000,
      mode: config.mode,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "扫描失败",
        detail: err.message ?? String(err),
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
