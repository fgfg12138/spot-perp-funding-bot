import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { createOrderIntent, recordBlockedAttempt } from "@/lib/strategy-v121/execution/orderIntent";
import { checkMainnetTinyGate } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyGate";
import type { ExchangeId } from "@/lib/strategy-v121/domain/types";

/** POST /api/v121/mainnet-tiny/intent — 创建执行意图（不下单） */
export async function POST(request: Request) {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const body = await request.json();
  const { symbol, spotExchange, perpExchange, plannedNotionalUsdt, batchNo } = body;

  if (!symbol || !spotExchange || !perpExchange) {
    return NextResponse.json({ error: "缺少必填字段: symbol, spotExchange, perpExchange" }, { status: 400 });
  }

  const mode = process.env.V121_MODE ?? "";
  // READ_ONLY/PAPER/SHADOW 不允许创建 intent
  if (["READ_ONLY", "PAPER", "SHADOW"].includes(mode)) {
    const gate = checkMainnetTinyGate();
    recordBlockedAttempt({
      mode, action: "create_intent", symbol,
      exchange: `${spotExchange}→${perpExchange}`,
      reason: `当前模式 ${mode} 不允许执行意图（不下单）`,
      gateStatus: gate,
    });
    return NextResponse.json({
      error: `当前模式 ${mode} 不允许真实下单。MAINNET_TINY 仍处于锁定状态。`,
      blocked: true,
    }, { status: 403 });
  }

  const intent = createOrderIntent({
    symbol, spotExchange: spotExchange as ExchangeId, perpExchange: perpExchange as ExchangeId,
    plannedNotionalUsdt: Number(plannedNotionalUsdt) || 10,
    batchNo: Number(batchNo) || 1,
  });

  return NextResponse.json({ ...intent, _realExecution: false, _message: "仅生成执行意图，未实际下单" });
}
