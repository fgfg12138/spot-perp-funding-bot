import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/orders */
export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const report = await getShadowReport();
  return NextResponse.json({
    orders: report.openOrders,
    totalCount: report.openOrders.length,
    message: "当前挂单 — 只读",
  });
}
