import { NextRequest, NextResponse } from "next/server";
import { executeGuardedClose } from "@/lib/strategy-v121/position/guardedCloseExecutor";
import { listRecentCloseExecutions } from "@/lib/strategy-v121/position/closeExecutionLedger";

/**
 * POST /api/v121/mainnet-tiny/close-execution
 *
 * 执行平仓：dryRun=true 时只走校验链；dryRun=false 时提交两腿 + 平仓后验证。
 * 镜像 order-execution/route.ts 的模式：读取 dryRun（默认 true），转发 explicitConfirm。
 *
 * 后端安全机制（precheckGate / kill switch / freeze / env gate / 确认串）
 * 完全由 guardedCloseExecutor 独立强制，本 route 只做参数转发。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun !== false;
    const result = await executeGuardedClose({
      closePlanId: body.closePlanId,
      dryRun,
      explicitConfirm: body.explicitConfirm,
      triggerReason: body.triggerReason,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, status: "failed", blockers: [err.message], warnings: [] },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const records = await listRecentCloseExecutions(20);
    return NextResponse.json({ ok: true, records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
