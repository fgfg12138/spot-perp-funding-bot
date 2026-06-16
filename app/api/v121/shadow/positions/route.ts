import { NextResponse } from "next/server";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/positions */
export async function GET() {
  const report = await getShadowReport();
  return NextResponse.json({
    positions: report.positions,
    totalCount: report.positions.length,
    message: "仓位快照 — 只读",
  });
}
