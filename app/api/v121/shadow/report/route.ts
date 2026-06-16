import { NextResponse } from "next/server";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/report */
export async function GET() {
  const report = await getShadowReport();

  const summary = {
    mode: report.mode,
    generatedAtUtc: report.generatedAtUtc,
    balanceCount: report.balances.length,
    positionCount: report.positions.length,
    orderCount: report.openOrders.length,
    warningCount: report.warnings.length,
    canModifyAccount: report.canModifyAccount,
    totalUsdtValue: report.balances.reduce((s, b) => s + (b.usdtValue ?? 0), 0),
  };

  return NextResponse.json({
    summary,
    warnings: report.warnings,
    message: "SHADOW 报告 — 只读",
  });
}
