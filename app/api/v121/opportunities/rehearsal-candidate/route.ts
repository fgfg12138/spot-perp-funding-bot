import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";

export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  try {
    const { selectLeastLossRehearsalCandidate } = await import(
      "@/lib/strategy-v121/opportunity/leastLossRehearsalSelector"
    );
    const candidate = selectLeastLossRehearsalCandidate();
    if (!candidate) return NextResponse.json({ message: "无可用模拟候选，请先触发扫描" });

    return NextResponse.json({ ...candidate, _note: "仅用于模拟测试，不允许真实下单" });
  } catch (err: any) {
    return NextResponse.json(
      { error: "获取模拟候选失败", detail: err.message ?? String(err) },
      { status: 500 },
    );
  }
}
