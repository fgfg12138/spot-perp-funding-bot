import { NextResponse } from "next/server";
import { checkMainnetTinyGate } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyGate";

/** GET /api/v121/mainnet-tiny/gate — 环境门状态，不泄露 secret */
export async function GET() {
  const gate = checkMainnetTinyGate();
  return NextResponse.json({
    ...gate,
    message: gate.allowed
      ? "配置门已满足，但真实执行仍需项目方单独确认。当前阶段不会真实下单。"
      : "MAINNET_TINY 环境门未满足。",
    _secret: "check_passed",
  });
}
