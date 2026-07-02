import { NextResponse } from "next/server";
import { runSafeExecutionDecision } from "@/lib/strategy-v121/execution/safeExecutionOrchestrator";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function pickLatestIntent(intents: any[]): any | null {
  if (intents.length === 0) return null;
  return [...intents]
    .filter(Boolean)
    .sort((a, b) => {
      const at = Number(a.createdAtUtc ?? a.created_at ?? a.ts ?? 0);
      const bt = Number(b.createdAtUtc ?? b.created_at ?? b.ts ?? 0);
      if (at === 0 && bt === 0) return 0;
      return bt - at;
    })[0] ?? intents[intents.length - 1] ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const intentId = searchParams.get("intentId");

  const repo = getRepository();
  const intents = repo.queryAll("order_intents") as any[];
  const intent = intentId
    ? intents.find((i: any) => i.intentId === intentId || i.id === intentId)
    : pickLatestIntent(intents);

  if (!intent) return NextResponse.json({ error: "无可用 intent" }, { status: 404 });

  const resolvedIntentId = intent.intentId ?? intent.id;
  const exchange = intent.spotExchange ?? intent.spot_exchange ?? intent.exchange;
  const symbol = intent.symbol;
  const plannedNotional = Number(intent.plannedNotionalUsdt ?? intent.planned_notional);
  const simulationOnly = toBool(intent.simulationOnly);
  const purpose = intent.purpose ?? (simulationOnly ? "execution_rehearsal" : "real_arbitrage");

  const missing: string[] = [];
  if (!resolvedIntentId) missing.push("intentId 缺失");
  if (!exchange) missing.push("exchange 缺失");
  if (!symbol) missing.push("symbol 缺失");
  if (!Number.isFinite(plannedNotional) || plannedNotional <= 0) missing.push("plannedNotionalUsdt 缺失或 <= 0");

  if (missing.length > 0) {
    return NextResponse.json({ error: "intent 字段不完整", blockers: missing }, { status: 400 });
  }

  const decision = await runSafeExecutionDecision({
    intentId: resolvedIntentId,
    exchange: exchange as any,
    symbol,
    plannedNotionalUsdt: plannedNotional,
    purpose: purpose as any,
    simulationOnly,
    realTradeEligible: toBool(intent.realTradeEligible),
  });

  return NextResponse.json({ ...decision, _note: "仅安全决策，未执行任何资金操作" });
}
