import { NextResponse } from "next/server";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/balances */
export async function GET() {
  const report = await getShadowReport();
  return NextResponse.json({
    balances: report.balances,
    totalCount: report.balances.length,
    message: "余额快照 — 只读",
  });
}
