import { NextRequest, NextResponse } from "next/server";
import { executeGuardedTwoLegOrder } from "@/lib/strategy-v121/execution/guardedOrderExecutor";
import { listRecentOrderExecutions } from "@/lib/strategy-v121/execution/orderExecutionLedger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun !== false;
    const result = await executeGuardedTwoLegOrder({
      orderPlanId: body.orderPlanId,
      dryRun,
      explicitConfirm: body.explicitConfirm,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, status: "frozen", blockers: [err.message], warnings: [] }, { status: 500 });
  }
}

export async function GET() {
  try {
    const records = await listRecentOrderExecutions(20);
    return NextResponse.json({ ok: true, records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
