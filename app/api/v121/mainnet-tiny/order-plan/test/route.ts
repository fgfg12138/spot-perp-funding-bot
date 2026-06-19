import { NextRequest, NextResponse } from "next/server";
import { findOrderPlanById } from "@/lib/strategy-v121/execution/orderPlanLedger";
import { createAccountAdapter } from "@/lib/strategy-v121/account/adapters/accountAdapterFactory";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plan = await findOrderPlanById(body.orderPlanId);
    if (!plan) return NextResponse.json({ ok: false, error: "order plan not found" }, { status: 404 });

    const { adapter } = createAccountAdapter(plan.exchange);
    if (!adapter.validateOrderPlan) {
      return NextResponse.json({ ok: false, blockers: ["validateOrderPlan not implemented by adapter"], warnings: [] });
    }

    const result = await adapter.validateOrderPlan(plan);
    return NextResponse.json({ ok: result.ok, status: result.ok ? "validated" : "blocked", blockers: result.blockers, warnings: result.warnings, raw: result.raw });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message, blockers: [err.message], warnings: [] }, { status: 500 });
  }
}
