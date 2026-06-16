import { NextResponse } from "next/server";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/orders */
export async function GET() {
  const report = await getShadowReport();
  return NextResponse.json({
    orders: report.openOrders,
    totalCount: report.openOrders.length,
    message: "当前挂单 — 只读",
  });
}
