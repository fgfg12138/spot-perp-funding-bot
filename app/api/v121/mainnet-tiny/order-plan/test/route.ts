import { NextRequest, NextResponse } from "next/server";
import { findOrderPlanById } from "@/lib/strategy-v121/execution/orderPlanLedger";
import { createAccountAdapter } from "@/lib/strategy-v121/account/adapters/accountAdapterFactory";

function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plan = await findOrderPlanById(body.orderPlanId);

    if (!plan) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["order plan not found"], warnings: [] }, { status: 404 });
    }

    if (plan.status !== "validated") {
      return NextResponse.json({
        ok: false, status: "blocked",
        blockers: [`order plan status is ${plan.status}; only validated plans can run spot test order`],
        warnings: [], orderPlanId: plan.id,
      });
    }

    if (!plan.spotLeg) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["order plan missing spotLeg"], warnings: [], orderPlanId: plan.id });
    }

    if (!plan.perpLeg) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["order plan missing perpLeg"], warnings: [], orderPlanId: plan.id });
    }

    if (!isPositiveFiniteNumber(plan.spotLeg.quoteNotionalUsdt)) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["spotLeg.quoteNotionalUsdt must be positive"], warnings: [], orderPlanId: plan.id });
    }

    if (!isPositiveFiniteNumber(plan.perpLeg.quantity)) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["perpLeg.quantity must be positive"], warnings: [], orderPlanId: plan.id });
    }

    const { adapter } = createAccountAdapter(plan.exchange);
    if (!adapter.validateOrderPlan) {
      return NextResponse.json({ ok: false, status: "blocked", blockers: ["validateOrderPlan not implemented by adapter"], warnings: [] });
    }

    const result = await adapter.validateOrderPlan(plan);
    return NextResponse.json({
      ok: result.ok,
      status: result.ok ? "validated" : "blocked",
      blockers: result.blockers,
      warnings: result.warnings,
      raw: result.raw,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, status: "failed", error: err.message, blockers: [err.message], warnings: [] }, { status: 500 });
  }
}
