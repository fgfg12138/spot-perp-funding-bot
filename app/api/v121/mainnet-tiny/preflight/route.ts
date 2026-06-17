import { NextResponse } from "next/server";
import { runMainnetTinyPreflight } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyPreflight";

/** GET /api/v121/mainnet-tiny/preflight — 预飞检查 */
export async function GET() {
  const result = runMainnetTinyPreflight();
  return NextResponse.json({
    ...result,
    message: "M9.1 预飞检查阶段：当前不会真实下单。",
  });
}
