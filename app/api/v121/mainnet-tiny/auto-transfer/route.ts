import { NextRequest, NextResponse } from "next/server";
import { executeAutoTransferAndReaudit } from "@/lib/strategy-v121/execution/autoTransferExecutor";
import { listRecentInternalTransfers } from "@/lib/strategy-v121/execution/internalTransferLedger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun !== false; // 默认 dry-run

    // Explicit confirm required for real execution
    if (dryRun === false) {
      if (body.explicitConfirm !== "EXECUTE_REAL_INTERNAL_TRANSFER") {
        return NextResponse.json({
          ok: false, status: "blocked",
          blockers: ["explicit_confirm_required"],
          warnings: [],
        }, { status: 400 });
      }
    }

    const result = await executeAutoTransferAndReaudit({
      intentId: body.intentId,
      decisionId: body.decisionId,
      transferPlan: body.transferPlan,
      dryRun,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, status: "frozen", error: err.message, blockers: [err.message], warnings: [] }, { status: 500 });
  }
}

export async function GET() {
  try {
    const records = await listRecentInternalTransfers(20);
    return NextResponse.json({ ok: true, records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
