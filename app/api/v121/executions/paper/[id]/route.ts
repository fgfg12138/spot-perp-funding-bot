import { NextResponse } from "next/server";
import {
  executeBatch, exitPosition, closePosition,
  reviewPosition, freezeExecution,
  openPosition,
  type FillResult,
} from "@/lib/strategy-v121/execution/paperLifecycle";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";
import { canProceedToNextBatch } from "@/lib/strategy-v121/execution/deviation";
import { getKillSwitch, isActionAllowed } from "@/lib/strategy-v121/risk/killSwitch";

/**
 * GET /api/v121/executions/paper/[id]
 *
 * Get full execution state by ID.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const ex = paperStore.findById(params.id);
  if (!ex) {
    return NextResponse.json({ error: "未找到执行记录" }, { status: 404 });
  }
  return NextResponse.json(ex);
}

/**
 * POST /api/v121/executions/paper/[id]
 *
 * Advance the paper lifecycle with an action.
 *
 * Body: { action: "batch" | "exit" | "cancel" | "review" | "open", ... }
 *
 * Actions:
 *   batch   — execute a batch (requires batchNo, spotFill, perpFill)
 *   open    — open the position (after all 3 batches confirmed)
 *   exit    — trigger exit
 *   cancel  — freeze the execution
 *   review  — mark as reviewed
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const ex = paperStore.findById(params.id);
  if (!ex) {
    return NextResponse.json({ error: "未找到执行记录" }, { status: 404 });
  }

  // Kill switch check
  const ks = getKillSwitch();
  if (!isActionAllowed("PAPER", ks)) {
    return NextResponse.json(
      { error: "Kill Switch 已阻断", killSwitch: ks },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const action = body.action as string;
  let updated = ex;

  switch (action) {
    case "batch": {
      const batchNo = (body.batchNo as number) ?? 1;
      const spotFill: FillResult | null = body.spotFill
        ? body.spotFill as FillResult : null;
      const perpFill: FillResult | null = body.perpFill
        ? body.perpFill as FillResult : null;

      // Pre-check: deviation must be safe before advancing
      if (batchNo > 1) {
        if (!canProceedToNextBatch(ex.positionDeviation)) {
          return NextResponse.json({
            error: `偏差 ${(ex.positionDeviation * 100).toFixed(2)}% > 1%，禁止进入下一批`,
            currentState: ex.state,
            deviation: ex.positionDeviation,
          }, { status: 409 });
        }
      }

      updated = executeBatch(ex, batchNo, spotFill, perpFill);

      // Check for freeze condition
      if (updated.state === "FROZEN") {
        paperStore.save(updated);
        return NextResponse.json({
          id: updated.id, state: updated.state,
          warning: "执行已冻结 — 订单状态不明",
          logs: updated.logs,
        }, { status: 200 });
      }

      break;
    }

    case "open": {
      if (ex.state !== "BATCH_3_CONFIRMED") {
        return NextResponse.json({
          error: `当前状态 ${ex.state} 不允许开仓，需完成全部 3 批`,
        }, { status: 409 });
      }
      updated = openPosition(ex);
      break;
    }

    case "exit": {
      if (!["OPEN", "MONITORING"].includes(ex.state)) {
        return NextResponse.json({
          error: `当前状态 ${ex.state} 不允许平仓`,
        }, { status: 409 });
      }
      updated = exitPosition(ex, (body.reason as string) ?? "手动平仓");
      break;
    }

    case "cancel": {
      updated = freezeExecution(ex, (body.reason as string) ?? "用户取消");
      break;
    }

    case "review": {
      if (ex.state !== "CLOSED") {
        return NextResponse.json({
          error: `当前状态 ${ex.state} 不允许复盘，需先平仓`,
        }, { status: 409 });
      }
      updated = reviewPosition(ex);
      break;
    }

    default:
      return NextResponse.json({
        error: `未知动作: ${action}。支持: batch, open, exit, cancel, review`,
      }, { status: 400 });
  }

  paperStore.save(updated);

  return NextResponse.json({
    id: updated.id,
    state: updated.state,
    action,
    spotNotional: updated.spotNotional,
    perpNotional: updated.perpNotional,
    positionDeviation: updated.positionDeviation,
    logs: updated.logs.slice(-5), // return last 5 log entries
  });
}
