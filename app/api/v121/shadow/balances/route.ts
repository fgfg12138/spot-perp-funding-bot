import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/balances */
export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const report = await getShadowReport();
  return NextResponse.json({
    balances: report.balances,
    totalCount: report.balances.length,
    message: "余额快照 — 只读",
  });
}
