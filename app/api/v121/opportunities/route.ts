import { NextResponse } from "next/server";
import { refreshAndScan } from "@/lib/strategy-v121/market/marketRefreshService";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";

/** GET /api/v121/opportunities — real market scan */
export async function GET() {
  try {
    const config = getConfig();
    const result = await refreshAndScan({
      plannedNotional: config.plannedNotional,
      makerRate: config.makerRate,
      takerRate: config.takerRate,
      isTakerEntry: false,
      systemHealthy: true,
    });

    return NextResponse.json({
      opportunities: result.scanResult?.opportunities ?? [],
      total: result.scanResult?.totalPaths ?? 0,
      passedCount: result.scanResult?.passedCount ?? 0,
      rejectedCount: result.scanResult?.rejectedCount ?? 0,
      scannedAtUtc: result.scanResult?.scannedAtUtc ?? 0,
      dataSource: result.errors.length === 0 ? "real_market" : "real_market_with_errors",
      errors: result.errors.map(e => ({ exchange: e.exchange, symbol: e.symbol, error: e.error })),
      mode: config.mode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "扫描失败", detail: String(err) },
      { status: 500 },
    );
  }
}
