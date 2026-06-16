import { NextResponse } from "next/server";
import { getLatestScan } from "@/lib/strategy-v121/opportunity/opportunityStore";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";

/** GET /api/v121/opportunities — 返回最近一次缓存扫描结果，不触发交易所 API */
export async function GET() {
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

  return NextResponse.json({
    ...latest,
    mode: config.mode,
  });
}
