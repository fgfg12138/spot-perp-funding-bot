import { NextResponse } from "next/server";
import { getOrderIntents } from "@/lib/strategy-v121/execution/orderIntent";

/** GET /api/v121/mainnet-tiny/intents — 历史执行意图列表 */
export async function GET() {
  return NextResponse.json({ intents: getOrderIntents(), total: getOrderIntents().length });
}
