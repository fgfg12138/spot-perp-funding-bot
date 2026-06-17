import { NextResponse } from "next/server";
import { selectLeastLossRehearsalCandidate } from "@/lib/strategy-v121/opportunity/leastLossRehearsalSelector";
import { createOrderIntent } from "@/lib/strategy-v121/execution/orderIntent";

export async function POST() {
  const candidate = selectLeastLossRehearsalCandidate();
  if (!candidate) return NextResponse.json({ error: "无可用模拟候选" }, { status: 404 });

  const intent = createOrderIntent({
    symbol: candidate.symbol,
    spotExchange: candidate.spotExchange as any,
    perpExchange: candidate.perpExchange as any,
    plannedNotionalUsdt: 10, batchNo: 1,
    reason: `模拟候选 ${candidate.id}`,
  });

  return NextResponse.json({
    ...intent,
    purpose: "execution_rehearsal",
    simulationOnly: true,
    realTradeEligible: false,
    _message: "仅生成模拟 dry-run intent，未实际下单",
  });
}
