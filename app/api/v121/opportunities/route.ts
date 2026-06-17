import { NextResponse } from "next/server";

/** GET /api/v121/opportunities — 返回最近一次缓存扫描结果 */
export async function GET() {
  try {
    const { getLatestScan } = await import("@/lib/strategy-v121/opportunity/opportunityStore");
    const { getConfig } = await import("@/lib/strategy-v121/config/strategyConfig");
    const config = getConfig();
    const latest = getLatestScan();

    if (!latest) {
      return NextResponse.json({
        opportunities: [],
        total: 0,
        passedCount: 0,
        rejectedCount: 0,
        rejectSummary: {},
        scannedAtUtc: 0,
        dataSource: "no_data",
        mode: config.mode,
        message: "暂无扫描结果，请先启动 Worker 或点击手动扫描。",
      });
    }

    return NextResponse.json({ ...latest, mode: config.mode });
  } catch (err: any) {
    return NextResponse.json(
      { error: "读取缓存失败", detail: err.message },
      { status: 500 },
    );
  }
}
