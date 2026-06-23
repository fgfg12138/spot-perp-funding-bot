import { NextRequest, NextResponse } from "next/server";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";
import { createAccountAdapter } from "@/lib/strategy-v121/account/adapters/accountAdapterFactory";
import { BinancePublicAdapter } from "@/lib/strategy-v121/market/adapters/binancePublicAdapter";
import { buildClosePlan } from "@/lib/strategy-v121/position/closePlanBuilder";
import { saveClosePlan } from "@/lib/strategy-v121/position/closePlanLedger";
import { listRecentClosePlans } from "@/lib/strategy-v121/position/closePlanLedger";
import { checkOrderConstraint } from "@/lib/strategy-v121/execution/orderConstraintPrecheck";
import type { ExchangeAccountSnapshot, CloseOrderBook } from "@/lib/strategy-v121/position/closeExecutionTypes";

/**
 * POST /api/v121/mainnet-tiny/close-plan
 *
 * 生成平仓方案：以交易所账户快照为 ground truth，构造可执行的 ClosePlan。
 * 方案持久化到 close_plan_ledger，但不下单。
 *
 * 严格边界：
 * - 仅支持 Binance 同所；OKX/HTX/跨所 → closePlanBuilder 内部 block。
 * - 交易所账户快照由 adapter 真实拉取（fetchBalances/fetchPositions/fetchOpenOrders）。
 * - 可平数量 = min(系统记录, 交易所实际)。
 * - 不调用任何下单接口。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const positionId = body.positionId as string | undefined;
    if (!positionId) {
      return NextResponse.json(
        { ok: false, status: "blocked", blockers: ["positionId required"], warnings: [] },
        { status: 400 },
      );
    }

    // 1) 取系统记录仓位
    const position = paperStore.findById(positionId);
    if (!position) {
      return NextResponse.json(
        { ok: false, status: "blocked", blockers: ["position not found"], warnings: [] },
        { status: 404 },
      );
    }

    // 2) 交易所边界：只支持 Binance 同所
    if (position.path.spotExchange !== "binance" || position.path.perpExchange !== "binance") {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        blockers: ["仅支持币安同所平仓，当前持仓路径不支持"],
        warnings: [],
        positionId,
        symbol: position.path.symbol,
      });
    }

    // 3) 拉取交易所账户快照（ground truth）
    const { adapter } = createAccountAdapter("binance");
    const rawSym = position.path.symbol.replace("/", "");
    let snapshot: ExchangeAccountSnapshot;
    try {
      const [balances, positions, openOrders] = await Promise.all([
        adapter.fetchBalances(),
        adapter.fetchPositions(),
        adapter.fetchOpenOrders(),
      ]);
      const base = position.path.symbol.split("/")[0];
      const spotBalance = (balances as any[]).find((b: any) => b.asset === base) ?? null;
      const perpShortPosition = (positions as any[]).find(
        (p: any) => p.symbol === position.path.symbol && p.side === "perp_short",
      ) ?? null;
      snapshot = {
        exchange: "binance",
        spotBalance: spotBalance ?? null,
        perpShortPosition: perpShortPosition ?? null,
        openOrders: openOrders as any[],
        fetchedAtUtc: new Date().toISOString(),
      };
    } catch (e: any) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        blockers: [`交易所快照拉取失败：${e.message ?? e}`],
        warnings: [],
        positionId,
        symbol: position.path.symbol,
      }, { status: 500 });
    }

    // 4) 拉取盘口（公共行情，无需 API key）
    const publicAdapter = new BinancePublicAdapter();
    let orderBook: CloseOrderBook;
    try {
      const [spotOb, perpOb, funding] = await Promise.all([
        publicAdapter.fetchOrderBookSpot(rawSym, 5),
        publicAdapter.fetchOrderBook(rawSym, 5),
        publicAdapter.fetchFundingInfo(rawSym),
      ]);
      orderBook = {
        spotBid1: spotOb.bids?.[0]?.[0] ?? 0,
        spotAsk1: spotOb.asks?.[0]?.[0] ?? 0,
        perpBid1: perpOb.bids?.[0]?.[0] ?? 0,
        perpAsk1: perpOb.asks?.[0]?.[0] ?? 0,
        markPrice: funding.markPrice ?? 0,
        fetchedAtUtc: new Date().toISOString(),
      };
    } catch (e: any) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        blockers: [`盘口拉取失败：${e.message ?? e}`],
        warnings: [],
        positionId,
        symbol: position.path.symbol,
      }, { status: 500 });
    }

    // 5) 拉取交易约束
    const constraint = await checkOrderConstraint("binance", position.path.symbol, 10);

    // 6) 生成平仓方案
    const realCloseEnabled = process.env.V121_ENABLE_REAL_CLOSE_EXECUTION === "1";
    const plan = await buildClosePlan({
      position,
      exchangeSnapshot: snapshot,
      orderBook,
      spotConstraints: {
        minQty: 0,
        stepSize: constraint.spotStepSize,
        minNotional: constraint.spotMinNotional,
      },
      perpConstraints: {
        minQty: 0,
        stepSize: constraint.perpStepSize,
        minNotional: constraint.perpMinNotional,
      },
      realCloseEnabled,
      intentId: body.intentId,
    });

    // 7) 持久化方案
    await saveClosePlan(plan);

    return NextResponse.json({
      ok: plan.status === "validated",
      status: plan.status,
      blockers: plan.blockers,
      warnings: plan.warnings,
      closePlan: plan,
      snapshot: {
        spotBalanceFree: snapshot.spotBalance?.free ?? 0,
        perpShortQty: snapshot.perpShortPosition?.quantity ?? 0,
        openOrderCount: snapshot.openOrders.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, status: "failed", error: err.message, blockers: [err.message], warnings: [] },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const records = await listRecentClosePlans(20);
    return NextResponse.json({ ok: true, records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
