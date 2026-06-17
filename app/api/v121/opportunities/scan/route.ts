import { NextResponse } from "next/server";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";

/** POST /api/v121/opportunities/scan — 手动触发一次真实行情扫描 */
export async function POST() {
  const config = getConfig();
  const start = Date.now();

  try {
    // 动态导入，避免顶层 import 失败导致整个路由不可用
    const { refreshAndScan } = await import("@/lib/strategy-v121/market/marketRefreshService");
    const { saveLatestScan } = await import("@/lib/strategy-v121/opportunity/opportunityStore");

    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate,
      takerRate: config.takerRate,
      isTakerEntry: false,
      systemHealthy: true,
    });
    const durationMs = Date.now() - start;
    const scan = result.scanResult!;

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
        symbolsScanned: 5,
        exchangesScanned: 3,
      });
    } catch { /* save is best-effort */ }

    return NextResponse.json({
      opportunities: scan.opportunities,
      total: scan.totalPaths,
      passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount,
      rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: "real_market",
      scannedAtUtc: scan.scannedAtUtc,
      durationMs,
      mode: config.mode,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "扫描失败", detail: err.message ?? String(err) },
      { status: 500 },
    );
  }
}
