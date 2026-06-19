import { NextRequest, NextResponse } from "next/server";
import { runPreOrderExecutionGate } from "@/lib/strategy-v121/execution/preOrderExecutionGate";
import { listRecentOrderPlans } from "@/lib/strategy-v121/execution/orderPlanLedger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
