import { NextResponse } from "next/server";

function parseMax(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** POST /api/v121/opportunities/scan
 *
 * 动态监控池 + 白名单机会检测：
 * - 数据层：动态扫描各交易所所有可用币种（每所上限 1000）
 * - 机会层：基于 OPPORTUNITY_WATCHLIST 白名单生成同所+跨所路径
 */
export async function POST(request: Request) {
  try {
    const { getConfig } = await import("@/lib/strategy-v121/config/strategyConfig");
    const { refreshAndScan } = await import("@/lib/strategy-v121/market/marketRefreshService");

    let body: any = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    const { loadSettings } = await import("@/lib/strategy-v121/settings/userStrategySettingsStore");
    const settings = await loadSettings();
    const settingsMax = settings?.universe?.maxDynamicSymbolsPerExchange;
    const maxDynamicSymbolsPerExchange = parseMax(body.maxDynamicSymbolsPerExchange, settingsMax ?? 1000);

    const config = getConfig();
    const t0 = Date.now();
    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate, takerRate: config.takerRate,
      isTakerEntry: false, systemHealthy: true,
      maxDynamicSymbolsPerExchange,
    });
    const elapsed = Date.now() - t0;

    const scan = result.scanResult;
    if (!scan) {
      return NextResponse.json({
        ok: false, error: "scanResult 为空",
        errors: result.errors.map(e => `${e.exchange}/${e.symbol}: ${e.error}`),
        elapsedMs: elapsed,
        scanMode: result.scanMode,
        dataSource: result.dataSource,
        dynamicUniverseWarnings: result.dynamicUniverseWarnings,
      }, { status: 500 });
    }

    const rejectSummary: Record<string, number> = {};
    for (const opp of scan.opportunities) {
      for (const r of opp.rejectReasons) rejectSummary[r.rule] = (rejectSummary[r.rule] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      opportunities: scan.opportunities,
      total: scan.totalPaths, passedCount: scan.passedCount,
      rejectedCount: scan.rejectedCount, rejectSummary,
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      dataSource: result.dataSource,
      scanMode: result.scanMode,
      dynamicUniverseCount: result.dynamicUniverseCount,
      dynamicUniverseByExchange: result.dynamicUniverseByExchange,
      dynamicUniverseWarnings: result.dynamicUniverseWarnings,
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
