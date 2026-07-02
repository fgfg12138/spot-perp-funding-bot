import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { createPaperExecution, startPrecheck } from "@/lib/strategy-v121/execution/paperLifecycle";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";
import { getKillSwitch, isActionAllowed } from "@/lib/strategy-v121/risk/killSwitch";
import { getConfig } from "@/lib/strategy-v121/config/strategyConfig";
import type { ExchangeId } from "@/lib/strategy-v121/domain/types";

/**
 * POST /api/v121/executions/paper
 *
 * Create a new Paper execution. Runs PRECHECK and returns the lifecycle state.
 * Blocked if Kill Switch prevents new entries.
 */
export async function POST(request: Request) {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  try {
    const ks = getKillSwitch();
    if (!isActionAllowed("PAPER", ks)) {
      return NextResponse.json(
        { error: "Kill Switch 已阻断新开仓", killSwitch: ks },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { symbol, spotExchange, perpExchange, totalNotional } = body;

    if (!symbol || !spotExchange || !perpExchange || !totalNotional) {
      return NextResponse.json(
        { error: "缺少必填字段: symbol, spotExchange, perpExchange, totalNotional" },
        { status: 400 }
      );
    }

    if (totalNotional <= 0) {
      return NextResponse.json({ error: "totalNotional 必须 > 0" }, { status: 400 });
    }

    const id = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = {
      symbol,
      spotExchange: spotExchange as ExchangeId,
      perpExchange: perpExchange as ExchangeId,
      isCrossExchange: spotExchange !== perpExchange,
    };

    let ex = createPaperExecution(id, path, totalNotional);
    ex = startPrecheck(ex);
    paperStore.save(ex);

    return NextResponse.json({
      id: ex.id,
      state: ex.state,
      path: ex.path,
      plan: ex.plan,
      logs: ex.logs,
      createdAtUtc: ex.createdAtUtc,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "创建执行失败", detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v121/executions/paper
 *
 * List all paper executions with summary fields.
 */
export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const list = paperStore.findAll();
  const summary = list.map(e => ({
    id: e.id,
    state: e.state,
    symbol: e.path.symbol,
    spotExchange: e.path.spotExchange,
    perpExchange: e.path.perpExchange,
    spotNotional: e.spotNotional,
    perpNotional: e.perpNotional,
    positionDeviation: e.positionDeviation,
    updatedAtUtc: e.updatedAtUtc,
  }));

  return NextResponse.json({
    executions: summary,
    total: summary.length,
    mode: getConfig().mode,
  });
}
