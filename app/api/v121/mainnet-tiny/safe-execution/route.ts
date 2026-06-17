import { NextResponse } from "next/server";
import { runSafeExecutionDecision } from "@/lib/strategy-v121/execution/safeExecutionOrchestrator";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intentId = searchParams.get("intentId");

  const repo = getRepository();
  const intents = repo.queryAll("order_intents") as any[];
  const intent = intentId
    ? intents.find((i: any) => i.intentId === intentId || i.id === intentId)
    : intents.length > 0 ? intents[intents.length - 1] : null;

  if (!intent) return NextResponse.json({ error: "无可用 intent" }, { status: 404 });

  const decision = await runSafeExecutionDecision({
    intentId: intent.intentId ?? intent.id ?? "",
    exchange: (intent.spotExchange ?? intent.spot_exchange ?? "binance") as any,
    symbol: intent.symbol ?? "BTC/USDT",
    plannedNotionalUsdt: Number(intent.plannedNotionalUsdt ?? intent.planned_notional ?? 10),
    purpose: (intent.purpose ?? "execution_rehearsal") as any,
    simulationOnly: intent.simulationOnly === true || intent.dryRun === true,
    realTradeEligible: intent.realTradeEligible !== false,
  });

  return NextResponse.json({ ...decision, _note: "仅安全决策，未执行任何资金操作" });
}
