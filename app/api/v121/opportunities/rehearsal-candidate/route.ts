import { NextResponse } from "next/server";
import { selectLeastLossRehearsalCandidate } from "@/lib/strategy-v121/opportunity/leastLossRehearsalSelector";

export async function GET() {
  const candidate = selectLeastLossRehearsalCandidate();
  if (!candidate) return NextResponse.json({ message: "无可用模拟候选" });

  return NextResponse.json({ ...candidate, _note: "仅用于模拟测试，不允许真实下单" });
}
