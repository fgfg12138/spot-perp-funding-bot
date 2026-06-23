import { NextResponse } from "next/server";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";

/**
 * 默认可见状态：持有中 / 监控中 / 平仓中 / 已暂停保护。
 * 已平仓（CLOSED）默认隐藏，需显式 ?include=closed 才返回。
 * 开仓前的瞬态（IDLE/PRECHECK/BATCH_*）与开仓失败（FAILED）不计入持仓。
 */
const VISIBLE_STATES = ["OPEN", "MONITORING", "EXITING", "FROZEN"];

/**
 * GET /api/v121/positions — 当前持仓监控。
 *
 * 默认只返回未平仓持仓（不含 CLOSED）。传入 ?include=closed 时追加已平仓记录。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeClosed = searchParams.get("include") === "closed";

  const allowed = includeClosed
    ? [...VISIBLE_STATES, "CLOSED"]
    : VISIBLE_STATES;

  const executions = paperStore.findAll();
  const positions = executions.filter(e => allowed.includes(e.state));

  return NextResponse.json({
    positions: positions.map(e => ({
      id: e.id,
      symbol: e.path.symbol,
      spotExchange: e.path.spotExchange,
      perpExchange: e.path.perpExchange,
      state: e.state,
      spotNotional: e.spotNotional,
      perpNotional: e.perpNotional,
      spotAvgPrice: e.spotAvgPrice,
      perpAvgPrice: e.perpAvgPrice,
      spotFilledQty: e.spotFilledQty,
      perpFilledQty: e.perpFilledQty,
      positionDeviation: e.positionDeviation,
      actualBasis: e.actualBasis,
      createdAtUtc: e.createdAtUtc,
      updatedAtUtc: e.updatedAtUtc,
      logs: e.logs.slice(-3),
    })),
    total: positions.length,
    includeClosed,
    dataSource: "paper-in-memory",
  });
}
