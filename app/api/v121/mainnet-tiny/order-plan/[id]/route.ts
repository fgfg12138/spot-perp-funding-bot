import { NextRequest, NextResponse } from "next/server";
import { findOrderPlanById } from "@/lib/strategy-v121/execution/orderPlanLedger";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await params;
    const record = await findOrderPlanById(resolved.id);
    if (!record) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, record });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
