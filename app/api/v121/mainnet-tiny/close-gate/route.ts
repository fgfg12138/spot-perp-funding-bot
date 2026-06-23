import { NextResponse } from "next/server";
import { checkMainnetTinyGate } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyGate";

/**
 * GET /api/v121/mainnet-tiny/close-gate — 平仓环境门状态，不泄露 secret
 *
 * 镜像 gate/route.ts 的模式，但暴露的是平仓专属门控：
 * - realCloseEnabled: V121_ENABLE_REAL_CLOSE_EXECUTION === "1"
 * - killSwitch: 当前 kill switch 状态（EXIT 在 PAUSE_NEW_ENTRIES 下仍允许）
 *
 * 这是只读显示字段，不改变 guardedCloseExecutor 的任何强制逻辑；
 * 真实平仓仍需 explicitConfirm + env + kill switch 同时满足才会执行。
 */
export async function GET() {
  const gate = checkMainnetTinyGate();
  const realCloseEnabled = process.env.V121_ENABLE_REAL_CLOSE_EXECUTION === "1";
  const killSwitch = process.env.V121_KILL_SWITCH ?? "OFF";
  return NextResponse.json({
    ...gate,
    realCloseEnabled,
    killSwitch,
    exitAllowedUnderKillSwitch: killSwitch === "OFF" || killSwitch === "PAUSE_NEW_ENTRIES",
    message: gate.allowed
      ? "配置门已满足，但真实平仓仍需项目方单独确认。当前阶段不会真实平仓。"
      : "MAINNET_TINY 环境门未满足。",
  });
}
