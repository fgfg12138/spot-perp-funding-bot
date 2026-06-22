import { NextRequest, NextResponse } from "next/server";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";
import { BinancePublicAdapter } from "@/lib/strategy-v121/market/adapters/binancePublicAdapter";
import { calcExitExecutableBasis } from "@/lib/strategy-v121/market/basis";
import { shouldExitPosition, type ExitCheckInput } from "@/lib/strategy-v121/position/exitRules";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";
import { loadSettings } from "@/lib/strategy-v121/settings/userStrategySettingsStore";

/**
 * POST /api/v121/positions/[id]/close-preview
 *
 * 生成平仓预案：拉取币安盘口 + 资金费率，调用纯函数 shouldExitPosition
 * 计算建议，再返回预估平仓价、基差、净收益等。
 *
 * 关键约束（来自产品化设计）：
 *   1. 仅支持币安（现货 + 合约都是 binance）。其它路径返回 supported=false，前端提示。
 *   2. 服务器端完成所有计算（纯函数 + 公共行情），不在客户端 import lib。
 *   3. 不调用任何下单接口（不调 submitOrderLeg / guardedOrderExecutor）。
 *   4. 返回中带免责声明"平仓预案，未执行真实下单"。
 *
 * 后端安全机制（preflight / safeExecution / 11-gate / kill switch / freeze）
 * 完全不被此 endpoint 触发，因为它不下单、不划转、只读行情。
 */

const EXCHANGE_BINANCE = "binance";

/** 币安现货 taker 费率近似值，仅用于平仓预案的费用估算。 */
const BINANCE_TAKER_FEE_RATE = 0.00075;
/** 平仓涉及 2 笔 taker 单（卖现货 + 买合约）。 */
const CLOSE_LEG_COUNT = 2;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // 1) 取持仓
    const position = paperStore.findById(id);
    if (!position) {
      return NextResponse.json(
        { ok: false, status: "not_found", message: "持仓不存在或已清理。" },
        { status: 404 },
      );
    }

    // 已平仓 / 已冻结的持仓不生成预案
    if (position.state === "CLOSED") {
      return NextResponse.json({
        ok: true,
        status: "already_closed",
        supported: true,
        positionId: id,
        symbol: position.path.symbol,
        message: "该持仓已平仓，无需生成平仓预案。",
        disclaimer: "平仓预案，未执行真实下单。",
      });
    }
    if (position.state === "FROZEN") {
      return NextResponse.json({
        ok: true,
        status: "frozen",
        supported: true,
        positionId: id,
        symbol: position.path.symbol,
        message: "持仓处于已暂停保护状态，请先在风控页处理后再生成平仓预案。",
        disclaimer: "平仓预案，未执行真实下单。",
      });
    }

    // 2) 仅币安支持（产品化约束）
    const spotEx = String(position.path.spotExchange ?? "").toLowerCase();
    const perpEx = String(position.path.perpExchange ?? "").toLowerCase();
    if (spotEx !== EXCHANGE_BINANCE || perpEx !== EXCHANGE_BINANCE) {
      return NextResponse.json({
        ok: true,
        status: "unsupported_exchange",
        supported: false,
        positionId: id,
        symbol: position.path.symbol,
        message: "当前平仓预案仅支持币安路径。该持仓路径暂不支持自动生成预案。",
        disclaimer: "平仓预案，未执行真实下单。",
      });
    }

    // 3) 拉取币安公共行情（无需 API key）
    const rawSym = String(position.path.symbol).replace("/", "");
    const adapter = new BinancePublicAdapter();

    let spotBid1 = 0;
    let perpAsk1 = 0;
    let fundingRate = 0;
    let nextFundingTimeUtc = 0;
    let markPrice = 0;
    let marketWarning: string | undefined;

    try {
      const spotOb = await adapter.fetchOrderBookSpot(rawSym, 5);
      spotBid1 = spotOb.bids?.[0]?.[0] ?? 0;
    } catch (e: any) {
      marketWarning = `现货盘口拉取失败：${e.message ?? e}`;
    }
    try {
      const perpOb = await adapter.fetchOrderBook(rawSym, 5);
      perpAsk1 = perpOb.asks?.[0]?.[0] ?? 0;
    } catch (e: any) {
      marketWarning = (marketWarning ? marketWarning + "；" : "") + `合约盘口拉取失败：${e.message ?? e}`;
    }
    try {
      const funding = await adapter.fetchFundingInfo(rawSym);
      fundingRate = funding.fundingRate ?? 0;
      nextFundingTimeUtc = funding.nextFundingTimeUtc ?? 0;
      markPrice = funding.markPrice ?? 0;
    } catch (e: any) {
      marketWarning = (marketWarning ? marketWarning + "；" : "") + `资金费率拉取失败：${e.message ?? e}`;
    }

    // 4) 计算平仓可成交基差（合约卖一 / 现货买一 - 1）
    const currentExitBasis = calcExitExecutableBasis(perpAsk1, spotBid1);

    // 5) 累计已实现资金费
    let realizedFunding = 0;
    try {
      const repo = getRepository();
      const settlements = repo.query("funding_settlements", (r) => r.position_id === id) as any[];
      realizedFunding = settlements.reduce((sum, r) => sum + Number(r.received ?? 0), 0);
    } catch {
      // 持久化未初始化或表不存在时按 0 处理
    }

    // 6) 名义金额与目标净收益
    const notional = Number(position.spotNotional ?? position.perpNotional ?? 0) || 0;
    const entryBasis = Number(position.actualBasis ?? 0) || 0;
    let settings: any = null;
    try {
      settings = await loadSettings();
    } catch {
      settings = null;
    }
    const minNetProfitRate = Number(settings?.funding?.minNetProfitRate ?? 0) || 0;
    // 注意：此处用原始 path 值判断，因为上方 binance 守卫已把 perpEx 收窄为 "binance"，
    // 直接比较 perpEx === "htx" 会被 TS 视为不可能比较。币安路径本身不是 HTX，
    // 是否按小币处理取决于 allowSmallCaps。
    const isHtxOrSmallCoin =
      String(position.path.perpExchange ?? "").toLowerCase() === "htx" ||
      Boolean(settings?.universe?.allowSmallCaps);
    const targetNetProfit = Math.max(
      minNetProfitRate * notional,
      entryBasis * notional * 0.85,
    );

    // 7) 估算平仓盈亏
    // 卖现货、买合约平仓：基差利润 = (entryBasis - currentExitBasis) * notional
    // 不含手续费与滑点的毛利；手续费按币安 taker 近似
    const basisProfit = (entryBasis - currentExitBasis) * notional;
    const estFees = notional * BINANCE_TAKER_FEE_RATE * CLOSE_LEG_COUNT;
    const estNetProfit = basisProfit + realizedFunding - estFees;

    // 8) 持仓时长
    const holdingHours = position.createdAtUtc
      ? Math.max(0, (Date.now() - Number(position.createdAtUtc)) / 3_600_000)
      : 0;

    // 9) 调用纯函数得出平仓建议
    const exitInput: ExitCheckInput = {
      currentExitBasis,
      entryBasis,
      expectedNetRate: minNetProfitRate, // 当前规则未使用，仅占位
      actualNetProfit: estNetProfit,
      targetNetProfit,
      nextFundingRate: fundingRate,
      holdingHours,
      isHtxOrSmallCoin,
    };
    const decision = shouldExitPosition(exitInput);

    // 10) 组装预案（用户语言，无工程词）
    return NextResponse.json({
      ok: true,
      status: "preview",
      supported: true,
      positionId: id,
      symbol: position.path.symbol,
      disclaimer: "平仓预案，未执行真实下单。",
      market: {
        spotBid1,
        perpAsk1,
        markPrice,
        fundingRate,
        nextFundingTimeUtc,
        scannedAtUtc: Date.now(),
        warning: marketWarning,
      },
      estimate: {
        entryBasis,
        currentExitBasis,
        basisProfit,
        realizedFunding,
        estFees,
        estNetProfit,
        notional,
        holdingHours,
      },
      decision: {
        shouldExit: decision.shouldExit,
        reason: decision.reason,
        priority: decision.priority,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, status: "error", error: err.message ?? String(err), disclaimer: "平仓预案，未执行真实下单。" },
      { status: 500 },
    );
  }
}
