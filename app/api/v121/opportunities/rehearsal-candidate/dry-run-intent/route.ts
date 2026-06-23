import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";

export async function POST() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  try {
    const { selectLeastLossRehearsalCandidate } = await import(
      "@/lib/strategy-v121/opportunity/leastLossRehearsalSelector"
    );
    const { createOrderIntent } = await import(
      "@/lib/strategy-v121/execution/orderIntent"
    );

    const candidate = selectLeastLossRehearsalCandidate();
    if (!candidate) return NextResponse.json({ error: "无可用模拟候选，请先触发扫描" }, { status: 404 });

    const intent = createOrderIntent({
      symbol: candidate.symbol,
      spotExchange: candidate.spotExchange as any,
      perpExchange: candidate.perpExchange as any,
      plannedNotionalUsdt: 10, batchNo: 1,
      reason: `模拟候选 ${candidate.id}`,
      dryRun: true,
      purpose: "execution_rehearsal",
      simulationOnly: true,
      realTradeEligible: false,
    });

    return NextResponse.json({
      ...intent,
      _message: "仅生成模拟 dry-run intent，未实际下单",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "生成失败", detail: err.message ?? String(err) },
      { status: 500 },
    );
  }
}
