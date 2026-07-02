import { NextResponse } from "next/server";
import { checkMainnetTinyGate } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyGate";

/** GET /api/v121/mainnet-tiny/gate — 环境门状态，不泄露 secret */
export async function GET() {
  const gate = checkMainnetTinyGate();
  // 暴露真实下单硬门控的当前状态（仅用于前端展示按钮是否可用）。
  // 注意：这是只读显示字段，不改变 guardedOrderExecutor 的任何强制逻辑；
  // 真实下单仍需 explicitConfirm + 此 env 同时满足才会执行。
  const realOrderExecutionEnabled = process.env.V121_ENABLE_REAL_ORDER_EXECUTION === "1";
  return NextResponse.json({
    ...gate,
    realOrderExecutionEnabled,
    message: gate.allowed
      ? "配置门已满足，但真实执行仍需项目方单独确认。当前阶段不会真实下单。"
      : "MAINNET_TINY 环境门未满足。",
    _secret: "check_passed",
  });
}
