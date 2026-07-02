import { NextResponse } from "next/server";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import { getConfiguredExchanges } from "@/lib/strategy-v121/account/shadowAccountService";

/** GET /api/v121/shadow — SHADOW mode status and key check */
export async function GET() {
  const config = getConfig();
  const keyStatus = getConfiguredExchanges();

  return NextResponse.json({
    mode: config.mode,
    isShadow: config.mode === "SHADOW",
    keyStatus: keyStatus.map(k => ({
      exchange: k.exchange,
      configured: k.configured,
    })),
    message: "SHADOW 模式 — 只读，不会下单或修改账户",
    warnings: keyStatus.filter(k => !k.configured).map(
      k => `${k.exchange} 未配置 API Key`,
    ),
  });
}
