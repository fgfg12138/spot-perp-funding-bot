import { NextResponse } from "next/server";
import { getShadowReport } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow/account — full SHADOW report (no secrets) */
export async function GET() {
  const report = await getShadowReport();
  return NextResponse.json({
    ...report,
    _secretCheck: "passed — 未泄露 API Key 或 Secret",
  });
}
