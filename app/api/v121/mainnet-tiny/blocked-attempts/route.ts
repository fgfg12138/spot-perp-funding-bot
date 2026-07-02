import { NextResponse } from "next/server";
import { getBlockedAttempts } from "@/lib/strategy-v121/execution/orderIntent";

/** GET /api/v121/mainnet-tiny/blocked-attempts — 被拦截的执行请求 */
export async function GET() {
  return NextResponse.json({ attempts: getBlockedAttempts(), total: getBlockedAttempts().length });
}
