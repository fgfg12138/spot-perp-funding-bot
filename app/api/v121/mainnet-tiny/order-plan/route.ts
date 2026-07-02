import { NextRequest, NextResponse } from "next/server";
import { runPreOrderExecutionGate } from "@/lib/strategy-v121/execution/preOrderExecutionGate";
import { listRecentOrderPlans } from "@/lib/strategy-v121/execution/orderPlanLedger";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Backend intent validation
    if (body.intentId) {
      const repo = getRepository();
      const intents = repo.queryAll("order_intents") as any[];
      const intent = intents.find((o: any) => o.id === body.intentId || o.intentId === body.intentId);

      if (intent) {
        const blockers: string[] = [];
        if (intent.purpose !== "real_arbitrage") blockers.push("intent purpose is not real_arbitrage");
        if (intent.simulationOnly === true || intent.simulationOnly === 1 || intent.simulationOnly === "1") {
          blockers.push("simulationOnly intent cannot create controlled live order plan");
        }
        if (intent.realTradeEligible !== true) blockers.push("intent realTradeEligible is not true");

        if (blockers.length > 0) {
          return NextResponse.json({ ok: false, status: "blocked", blockers, intent, evidence: { rejectedBy: "backend_intent_validation" } });
        }
      }
    }

    const result = await runPreOrderExecutionGate({
      intentId: body.intentId,
      decisionId: body.decisionId,
      exchange: body.exchange ?? "binance",
      symbol: body.symbol,
      plannedNotionalUsdt: body.plannedNotionalUsdt ?? 10,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, status: "frozen", error: err.message, blockers: [err.message], warnings: [] }, { status: 500 });
  }
}

export async function GET() {
  try {
    const records = await listRecentOrderPlans(20);
    return NextResponse.json({ ok: true, records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
