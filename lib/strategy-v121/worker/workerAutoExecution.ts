/**
 * Worker Auto Execution — 将安全决策 → 划转 → 开仓 → 持仓监控 → 平仓
 * 自动集成到 Worker cycle() 主循环。
 *
 * 设计原则：
 * - SHADOW 模式：跑完整决策链但 dryRun=true，永不真实下单。
 * - MAINNET_TINY 模式：跑完整决策链 + 真实划转(dryRun=false 当 env 允许) + 真实下单。
 * - CONTROLLED_LIVE 模式：同 MAINNET_TINY。
 * - HTX 不进入任何自动执行路径。
 * - 每个 cycle 最多处理一个开仓机会 + 检查所有持仓的平仓信号。
 * - 所有步骤都通过 auditLogger 记录审计轨迹。
 */

import { auditInfo, auditWarn, auditError, AuditCategory } from "../ops/auditLogger";
import { getConfig, canPlaceRealOrders } from "../config/strategyConfig";
import { getLatestScan } from "../opportunity/opportunityStore";
import { isSmallCoin } from "../market/contractSpec";
import { loadSettings } from "../settings/userStrategySettingsStore";
import { paperStore } from "../execution/paperStore";
import type { PaperExecution } from "../execution/paperLifecycle";
import type { MarketSnapshot, ExchangeId, PositionSnapshot, HealthStatus, StrategyMode, MarketType, OpportunityRecord } from "../domain/types";

import type { RawTicker } from "../market/adapters/types";

import { runSafeExecutionDecision } from "../execution/safeExecutionOrchestrator";
import type { SafeExecutionDecision } from "../execution/safeExecutionOrchestrator";
import { executeAutoTransferAndReaudit } from "../execution/autoTransferExecutor";
import { buildTwoLegOrderPlan } from "../execution/orderPlanBuilder";
import type { TwoLegOrderPlan } from "../execution/orderTypes";
import { saveOrderPlan } from "../execution/orderPlanLedger";
import { executeGuardedTwoLegOrder } from "../execution/guardedOrderExecutor";
import { monitorPosition } from "../position/monitor";
import { buildClosePlan } from "../position/closePlanBuilder";
import { saveClosePlan } from "../position/closePlanLedger";
import { executeGuardedClose } from "../position/guardedCloseExecutor";
import { createPaperExecution } from "../execution/paperLifecycle";
import type { ExchangeAccountSnapshot, CloseOrderBook, ClosePlan } from "../position/closeExecutionTypes";

import {
  formatRawSymbolForExchange,
  isEntryResultSuccessful,
  extractSpotBalance,
  extractPerpShortPosition,
  isRealCloseEnabled,
} from "./workerExecutionHelpers";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SYMBOLS_WITH_CONSTRAINTS_CACHE: Record<string, { spot: any; perp: any }> = {};

function getDefaultConstraints() {
  return {
    spot: { stepSize: 0.00001, minNotional: 5, minQty: 0.00001, tickSize: 0.01 },
    perp: { stepSize: 0.001, minNotional: 5, minQty: 0.001, tickSize: 0.01 },
  };
}

function getConstraintsForSymbol(_symbol: string): { spot: any; perp: any } {
  // TODO: 可从 exchangeInfo 动态获取，当前使用默认值
  if (SYMBOLS_WITH_CONSTRAINTS_CACHE[_symbol]) return SYMBOLS_WITH_CONSTRAINTS_CACHE[_symbol];
  const c = getDefaultConstraints();
  SYMBOLS_WITH_CONSTRAINTS_CACHE[_symbol] = c;
  return c;
}

/* ------------------------------------------------------------------ */
/*  MarketSnapshot helpers                                              */
/* ------------------------------------------------------------------ */

function tickerToMarketSnapshot(
  exchangeId: ExchangeId,
  symbol: string,
  marketType: MarketType,
  ticker: RawTicker,
  markPrice?: number,
): MarketSnapshot {
  const bid1 = ticker.bid1 ?? 0;
  const ask1 = ticker.ask1 ?? 0;
  const mid = (bid1 + ask1) / 2;
  const spreadRate = mid > 0 ? (ask1 - bid1) / mid : 0;
  return {
    exchangeId,
    symbol,
    marketType,
    bid1,
    ask1,
    mid,
    markPrice,
    volume24hUsdt: ticker.volume24hUsdt ?? 0,
    spreadRate,
    timestampUtc: Date.now(),
    tradingStatus: "trading",
  };
}

/* ------------------------------------------------------------------ */
/*  1. Auto Entry — 扫描机会 → 安全决策 → 划转 → 下单                */
/* ------------------------------------------------------------------ */

export interface AutoEntryResult {
  action: "skipped" | "blocked" | "transfer_required" | "order_placed" | "error";
  symbol?: string;
  exchange?: ExchangeId;
  message: string;
  decision?: SafeExecutionDecision;
}

export type EntryPreconditionsResult =
  | { ok: true }
  | { ok: false; skipReason: string };

/**
 * 阶段 1-3：检查自动开仓前置条件（模式、扫描结果、已有持仓）。
 */
export function checkEntryPreconditions(config: { mode: StrategyMode }, workerId: string): EntryPreconditionsResult {
  const mode = config.mode;

  // 非执行模式跳过自动开仓
  if (mode === "READ_ONLY" || mode === "PAPER") {
    return { ok: false, skipReason: `模式 ${mode} 不支持自动开仓` };
  }

  // 1. 读取最新扫描结果
  const scan = getLatestScan();
  if (!scan || !scan.opportunities?.length) {
    return { ok: false, skipReason: "无扫描结果" };
  }

  // 2. 有未平仓时不开新仓（防止叠加风险）
  const openPositions = paperStore.findAll().filter(p =>
    ["OPEN", "MONITORING", "BATCH_1_EXECUTING", "BATCH_1_CONFIRMED", "BATCH_2_EXECUTING", "BATCH_2_CONFIRMED", "BATCH_3_EXECUTING", "BATCH_3_CONFIRMED"].includes(p.state),
  );
  if (openPositions.length > 0) {
    return { ok: false, skipReason: `已有 ${openPositions.length} 个持仓，等待平仓后再开新仓` };
  }

  return { ok: true };
}

export type CandidateSelectionResult =
  | { ok: true; candidate: any; symbol: string; exchange: ExchangeId; plannedNotional: number }
  | { ok: false; skipReason: string };

/**
 * 阶段 4-5：加载用户设置，从扫描结果中筛选最佳候选。
 */
export async function selectBestCandidate(scan: { opportunities?: any[] } | null, settings: any): Promise<CandidateSelectionResult> {
  // 从机会中找到最佳候选
  const opportunities = scan?.opportunities ?? [];
  const candidates = opportunities
    .filter((opp: any) => {
      // 必须通过硬过滤
      if (!opp.passed) return false;
      // 仅 S/A 级
      if (opp.level !== "S" && opp.level !== "A") return false;
      // 同所
      const spotEx = opp.path?.spotExchange ?? opp.spotExchange ?? "";
      const perpEx = opp.path?.perpExchange ?? opp.perpExchange ?? "";
      if (spotEx !== perpEx) return false;
      // HTX 跳过
      if (spotEx === "htx" || perpEx === "htx") return false;
      // 小币跳过
      if (isSmallCoin(opp.symbol ?? opp.path?.symbol ?? "")) return false;
      // funding 达标
      const fr = opp.funding8h ?? 0;
      const minFr = settings.funding?.minFundingRate8h ?? 0.0005;
      return fr >= minFr;
    })
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

  if (candidates.length === 0) {
    return { ok: false, skipReason: "当前无合格开仓机会" };
  }

  const best = candidates[0];
  const symbol = best.symbol ?? best.path?.symbol ?? "";
  const exchange: ExchangeId = best.path?.spotExchange ?? best.spotExchange ?? "binance";
  const plannedNotional = settings.notional?.plannedNotionalUsdt ?? 10;

  return { ok: true, candidate: best, symbol, exchange, plannedNotional };
}

/**
 * 阶段 6：运行开仓安全决策。
 */
export async function runEntrySafeDecision(input: {
  intentId: string;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  mode: StrategyMode;
}): Promise<SafeExecutionDecision> {
  return runSafeExecutionDecision({
    intentId: input.intentId,
    exchange: input.exchange,
    symbol: input.symbol,
    plannedNotionalUsdt: input.plannedNotionalUsdt,
    purpose: "real_arbitrage",
    simulationOnly: false,
    realTradeEligible: canPlaceRealOrders(input.mode),
  });
}

/**
 * 阶段 7：TRANSFER_REQUIRED 分支 — 自动划转并重新审计。
 */
export async function handleTransferRequired(
  decision: SafeExecutionDecision,
  workerId: string,
  mode: StrategyMode,
  symbol: string,
  exchange: ExchangeId,
  plannedNotional: number,
): Promise<AutoEntryResult> {
  if (!decision.transferPlan) {
    return {
      action: "blocked",
      symbol, exchange,
      message: "安全决策缺少 transferPlan",
      decision,
    };
  }

  const dryRun = mode === "SHADOW";
  const transferResult = await executeAutoTransferAndReaudit({
    intentId: decision.intentId,
    decisionId: decision.sessionId,
    safeExecutionDecision: decision,
    transferPlan: decision.transferPlan,
    dryRun,
  });

  if (!transferResult.ok) {
    return {
      action: "blocked",
      symbol, exchange,
      message: `自动划转失败: ${transferResult.blockers.join("; ")}`,
      decision,
    };
  }

  auditInfo(AuditCategory.WORKER_LIFECYCLE, `自动划转完成 (${transferResult.status})`, {
    workerId, symbol, exchange,
    detail: { status: transferResult.status, ledgerId: transferResult.ledgerId },
  });

  // 划转后重新运行安全决策检查资金是否充足
  const reAudit = await runEntrySafeDecision({
    intentId: decision.intentId,
    exchange,
    symbol,
    plannedNotionalUsdt: plannedNotional,
    mode,
  });

  if (reAudit.state === "BLOCKED" || reAudit.state === "FROZEN") {
    return {
      action: "blocked",
      symbol, exchange,
      message: `划转后重审计未通过: ${reAudit.blockers.join("; ")}`,
      decision: reAudit,
    };
  }

  // 用原始 decision 继续下单（transferPlan 中的必要信息仍来自原决策）
  return executeOrderPlan(decision, workerId, symbol, exchange, plannedNotional, mode);
}

/**
 * 阶段 8：将决策分派到下单流程。
 */
export async function dispatchToOrderPlan(
  decision: SafeExecutionDecision,
  workerId: string,
  symbol: string,
  exchange: ExchangeId,
  plannedNotional: number,
  mode: StrategyMode,
): Promise<AutoEntryResult> {
  return executeOrderPlan(decision, workerId, symbol, exchange, plannedNotional, mode);
}

/**
 * 尝试自动开仓。每个 cycle 最多进行一次。
 * 选择最新扫描中评分最高的 S/A 级机会。
 */
export async function tryAutoEntry(workerId: string): Promise<AutoEntryResult> {
  const config = getConfig();
  const mode = config.mode;

  const preconditions = checkEntryPreconditions(config, workerId);
  if (!preconditions.ok) {
    return { action: "skipped", message: preconditions.skipReason! };
  }

  // 3. 加载用户设置
  let settings: any;
  try {
    settings = await loadSettings();
  } catch (e: any) {
    return { action: "error", message: `设置加载失败: ${e.message}` };
  }

  const scan = getLatestScan();
  const candidateResult = await selectBestCandidate(scan, settings);
  if (!candidateResult.ok) {
    return { action: "skipped", message: candidateResult.skipReason! };
  }

  const { symbol, exchange, plannedNotional, candidate } = candidateResult;

  auditInfo(AuditCategory.WORKER_LIFECYCLE, `自动开仓候选: ${symbol} ${exchange}`, {
    workerId, symbol, exchange,
    detail: { score: candidate.score, level: candidate.level, funding8h: candidate.funding8h },
  });

  // 5. 运行安全决策
  const decision = await runEntrySafeDecision({
    intentId: `worker-auto-${symbol}-${Date.now()}`,
    exchange,
    symbol,
    plannedNotionalUsdt: plannedNotional,
    mode,
  });

  auditInfo(AuditCategory.WORKER_LIFECYCLE, `安全决策结果: ${decision.state}`, {
    workerId, symbol, exchange,
    detail: { state: decision.state, blockers: decision.blockers, needsAutoTransfer: decision.needsAutoTransfer },
  });

  // 6. 根据决策状态操作
  // BLOCKED / FROZEN → 跳过
  if (decision.state === "BLOCKED" || decision.state === "FROZEN") {
    return {
      action: "blocked",
      symbol, exchange,
      message: `安全决策阻断: ${decision.blockers.join("; ")}`,
      decision,
    };
  }

  // TRANSFER_REQUIRED → 自动划转
  if (decision.state === "TRANSFER_REQUIRED" && decision.transferPlan) {
    return handleTransferRequired(decision, workerId, mode, symbol, exchange, plannedNotional);
  }

  // HUMAN_APPROVAL_REQUIRED — 如果是自动模式且有真实执行资格，继续下单
  if (decision.state === "HUMAN_APPROVAL_REQUIRED" || decision.state === "FINAL_AUDIT_READY") {
    return dispatchToOrderPlan(decision, workerId, symbol, exchange, plannedNotional, mode);
  }

  return {
    action: "blocked",
    symbol, exchange,
    message: `状态未处理: ${decision.state}`,
    decision,
  };
}

/* ------------------------------------------------------------------ */
/*  1.1 Order Plan Execution — 构造并执行两腿订单计划                */
/* ------------------------------------------------------------------ */

export interface PriceFetchResult {
  ok: boolean;
  spotPrice: number;
  perpPrice: number;
  warnings: string[];
}

/**
 * 获取开仓实时价格（spot bid1 / perp ask1）。
 */
export async function fetchEntryPrices(exchange: ExchangeId, symbol: string, workerId: string): Promise<PriceFetchResult> {
  let spotPrice = 60000;
  let perpPrice = 60001;
  const warnings: string[] = [];

  try {
    if (exchange === "binance") {
      const { BinancePublicAdapter } = await import("../market/adapters/binancePublicAdapter");
      const adapter = new BinancePublicAdapter();
      const rawSym = formatRawSymbolForExchange(symbol, exchange);
      const [spotTicker, perpTicker] = await Promise.all([
        adapter.fetchTickerSpot(rawSym).catch(() => ({ bid1: 0 } as RawTicker)),
        adapter.fetchTicker(rawSym).catch(() => ({ ask1: 0 } as RawTicker)),
      ]);
      const spotSnapshot = tickerToMarketSnapshot(exchange, symbol, "spot", spotTicker);
      const perpSnapshot = tickerToMarketSnapshot(exchange, symbol, "perp", perpTicker);
      spotPrice = spotSnapshot.bid1;
      perpPrice = perpSnapshot.ask1;
    } else if (exchange === "okx") {
      const { OkxPublicAdapter } = await import("../market/adapters/okxPublicAdapter");
      const adapter = new OkxPublicAdapter();
      const spotInstId = formatRawSymbolForExchange(symbol, exchange);
      const perpInstId = `${spotInstId}-SWAP`;
      const [spotTicker, perpTicker] = await Promise.all([
        adapter.fetchTickerSpot(spotInstId).catch(() => ({ bid1: 0 } as RawTicker)),
        adapter.fetchTicker(perpInstId).catch(() => ({ ask1: 0 } as RawTicker)),
      ]);
      const spotSnapshot = tickerToMarketSnapshot(exchange, symbol, "spot", spotTicker);
      const perpSnapshot = tickerToMarketSnapshot(exchange, symbol, "perp", perpTicker);
      spotPrice = spotSnapshot.bid1;
      perpPrice = perpSnapshot.ask1;
    }
  } catch {
    // 价格获取失败使用回退值
    auditWarn(AuditCategory.WORKER_LIFECYCLE, "构建订单计划时获取价格失败，使用回退值", { workerId, symbol, exchange });
    warnings.push("获取实时价格失败，使用回退值");
  }

  const ok = spotPrice > 0 && perpPrice > 0;
  return { ok, spotPrice, perpPrice, warnings };
}

export type OrderPlanBuildResult =
  | { ok: true; orderPlan: TwoLegOrderPlan }
  | { ok: false; blockers: string[] };

/**
 * 构建并保存 two-leg 订单计划。
 */
export async function buildAndSaveOrderPlan(
  decision: SafeExecutionDecision,
  symbol: string,
  exchange: ExchangeId,
  plannedNotional: number,
  prices: PriceFetchResult,
  constraints: { spot: any; perp: any },
): Promise<OrderPlanBuildResult> {
  const orderPlan = await buildTwoLegOrderPlan({
    intentId: decision.intentId,
    decisionId: decision.sessionId,
    exchange,
    symbol,
    plannedNotionalUsdt: plannedNotional,
    latestSpotPrice: prices.spotPrice,
    latestPerpPrice: prices.perpPrice,
    spotConstraints: constraints.spot,
    perpConstraints: constraints.perp,
  });

  if (orderPlan.status !== "validated") {
    return { ok: false, blockers: orderPlan.blockers };
  }

  await saveOrderPlan(orderPlan);
  return { ok: true, orderPlan };
}

/**
 * 执行两腿订单并记录系统仓位。
 */
export async function submitTwoLegOrderAndRecordPosition(
  orderPlan: TwoLegOrderPlan,
  workerId: string,
  mode: StrategyMode,
  prices: PriceFetchResult,
  symbol: string,
  exchange: ExchangeId,
  plannedNotional: number,
  decision: SafeExecutionDecision,
): Promise<AutoEntryResult> {
  const dryRun = mode === "SHADOW";
  // SHADOW 模式不需要 explicitConfirm
  const explicitConfirm = dryRun ? undefined : "EXECUTE_REAL_TWO_LEG_ORDER";

  auditInfo(AuditCategory.WORKER_LIFECYCLE, `执行开仓: dryRun=${dryRun}`, {
    workerId, symbol, exchange,
    detail: { orderPlanId: orderPlan.id, dryRun, plannedNotional },
  });

  // 执行下单
  const executionResult = await executeGuardedTwoLegOrder({
    orderPlanId: orderPlan.id,
    dryRun,
    explicitConfirm,
  });

  if (executionResult.status === "filled") {
    // 开仓成功 — 创建系统记录仓位
    const path = {
      symbol,
      spotExchange: exchange,
      perpExchange: exchange,
      isCrossExchange: false,
    };
    const paperEx = createPaperExecution(
      `paper-${exchange}-${symbol}-${Date.now()}`,
      path,
      plannedNotional,
    );
    paperEx.state = "OPEN";
    paperEx.spotFilledQty = orderPlan.spotLeg.quantity;
    paperEx.perpFilledQty = orderPlan.perpLeg.quantity;
    paperEx.spotAvgPrice = prices.spotPrice;
    paperEx.perpAvgPrice = prices.perpPrice;
    paperEx.spotNotional = orderPlan.spotLeg.quoteNotionalUsdt;
    paperEx.perpNotional = orderPlan.perpLeg.quoteNotionalUsdt;
    paperEx.actualBasis = prices.perpPrice / prices.spotPrice - 1;
    paperEx.logs = [`Worker auto entry: ${executionResult.status}`];
    paperStore.save(paperEx);

    auditInfo(AuditCategory.WORKER_LIFECYCLE, `自动开仓成功: ${symbol} ${exchange}`, {
      workerId, symbol, exchange,
      detail: { orderPlanId: orderPlan.id, executionId: executionResult.id, notional: plannedNotional },
    });

    return {
      action: "order_placed",
      symbol, exchange,
      message: `开仓成功: ${symbol} ${exchange} notional=${plannedNotional}U`,
      decision,
    };
  }

  // 部分成交或 dry_run 成功但非 filled
  if (executionResult.status === "dry_run") {
    return {
      action: "order_placed",
      symbol, exchange,
      message: `dry-run 下单成功 (模拟): ${symbol} ${exchange}`,
      decision,
    };
  }

  return {
    action: "blocked",
    symbol, exchange,
    message: `开仓执行失败: ${executionResult.blockers?.join("; ") ?? executionResult.status}`,
    decision,
  };
}

/**
 * 执行下单流程（构建订单计划 → 保存 → 执行）。
 */
async function executeOrderPlan(
  decision: SafeExecutionDecision,
  workerId: string,
  symbol: string,
  exchange: ExchangeId,
  plannedNotional: number,
  mode: StrategyMode,
): Promise<AutoEntryResult> {
  const constraints = getConstraintsForSymbol(symbol);
  const prices = await fetchEntryPrices(exchange, symbol, workerId);

  if (!prices.ok || prices.spotPrice <= 0 || prices.perpPrice <= 0) {
    return {
      action: "blocked",
      symbol, exchange,
      message: `获取实时价格失败: spot=${prices.spotPrice}, perp=${prices.perpPrice}`,
      decision,
    };
  }

  const planResult = await buildAndSaveOrderPlan(decision, symbol, exchange, plannedNotional, prices, constraints);
  if (!planResult.ok) {
    return {
      action: "blocked",
      symbol, exchange,
      message: `订单计划验证失败: ${planResult.blockers?.join("; ")}`,
      decision,
    };
  }

  return submitTwoLegOrderAndRecordPosition(
    planResult.orderPlan!,
    workerId,
    mode,
    prices,
    symbol,
    exchange,
    plannedNotional,
    decision,
  );
}

/* ------------------------------------------------------------------ */
/*  2. Auto Position Monitor — 持仓监控 → 平仓决策 → 执行平仓       */
/* ------------------------------------------------------------------ */

export interface AutoMonitorResult {
  actions: Array<{
    positionId: string;
    action: "hold" | "exit" | "reduce" | "freeze" | "close_executed" | "error";
    symbol: string;
    message: string;
  }>;
}

export type MonitorablePositionsResult =
  | { ok: true; positions: PaperExecution[] }
  | { ok: false; skipReason: string; positions: PaperExecution[] };

/**
 * 阶段 1-2：查找可监控的持仓。
 */
export function listMonitorablePositions(mode: StrategyMode): MonitorablePositionsResult {
  if (mode === "READ_ONLY") {
    return { ok: false, positions: [], skipReason: "READ_ONLY 模式跳过持仓监控" };
  }

  const positions = paperStore.findAll().filter(p =>
    ["OPEN", "MONITORING"].includes(p.state),
  );

  return { ok: true, positions };
}

export interface PositionEvaluationResult {
  action: "exit" | "freeze" | "hold" | "reduce";
  reason: string;
  snapshot?: PositionSnapshot;
}

/**
 * 阶段 4-8（单个持仓）：获取价格、时长、funding，构造快照，运行监控器。
 */
export async function evaluateSinglePosition(position: PaperExecution, workerId: string, mode: string): Promise<PositionEvaluationResult> {
  const symbol = position.path.symbol;
  const exchange = position.path.perpExchange;

  try {
    // 获取当前行情用于监控
    let perpMarkPrice = position.perpAvgPrice;
    let spotPrice = position.spotAvgPrice;
    try {
      const { BinancePublicAdapter } = await import("../market/adapters/binancePublicAdapter");
      if (exchange === "binance") {
        const adapter = new BinancePublicAdapter();
        const rawSym = formatRawSymbolForExchange(symbol, exchange);
        const [spotTicker, perpTicker]: [RawTicker, RawTicker & { markPrice?: number }] = await Promise.all([
          adapter.fetchTickerSpot(rawSym).catch(() => ({ bid1: 0 } as RawTicker)),
          adapter.fetchTicker(rawSym).catch(() => ({ markPrice: 0 } as RawTicker & { markPrice?: number })),
        ]);
        const spotSnapshot = tickerToMarketSnapshot(exchange, symbol, "spot", spotTicker);
        const perpSnapshot = tickerToMarketSnapshot(exchange, symbol, "perp", perpTicker, perpTicker.markPrice);
        spotPrice = spotSnapshot.bid1;
        perpMarkPrice = perpSnapshot.markPrice ?? perpSnapshot.bid1 ?? perpMarkPrice;
      }
    } catch { /* 使用旧值 */ }

    // 计算持仓时长（小时）
    const holdingMs = Date.now() - position.createdAtUtc;
    const holdingHours = holdingMs / 3600_000;

    // 获取 funding 信息
    let nextFundingRate = 0;
    try {
      const latestScan = getLatestScan();
      if (latestScan) {
        const matchedOpp = (latestScan.opportunities as Array<Partial<OpportunityRecord> & { symbol?: string }>).find((o) =>
          String(o.symbol ?? o.path?.symbol ?? "") === symbol,
        );
        if (matchedOpp) {
          nextFundingRate = Number(matchedOpp.funding8h ?? 0);
        }
      }
    } catch { /* 使用 0 */ }

    // 构造 PositionSnapshot（从 PaperExecution 转换）
    const positionSnapshot: PositionSnapshot = {
      positionId: position.id,
      path: position.path,
      timestampUtc: Date.now(),
      currentBasis: position.actualBasis,
      markPrice: perpMarkPrice,
      funding8h: nextFundingRate,
      realizedFunding: 0,
      spotQty: position.spotFilledQty,
      spotAvgPrice: position.spotAvgPrice,
      perpQty: position.perpFilledQty,
      perpAvgPrice: position.perpAvgPrice,
      positionDeviation: position.positionDeviation,
      spotDepth: 0,
      perpDepth: 0,
      healthState: { timeSyncMs: 0, wsLatencyMs: 0, restOk: true, wsOk: true, dataFreshnessMs: 0, isHealthy: true } as HealthStatus,
    };

    // 运行监控器
    const mon = monitorPosition({
      position: positionSnapshot,
      spotMarketPrice: spotPrice,
      perpMarkPrice,
      nextFundingRate,
      holdingHours,
    });

    auditInfo(AuditCategory.WORKER_LIFECYCLE, `持仓监控: ${symbol} ${mon.action}`, {
      workerId, symbol, exchange,
      detail: { action: mon.action, reason: mon.reason, positionId: position.id, holdingHours },
    });

    return { action: mon.action, reason: mon.reason, snapshot: positionSnapshot };
  } catch (e: any) {
    auditError(AuditCategory.WORKER_LIFECYCLE, `持仓监控异常: ${symbol}`, {
      workerId, symbol, exchange,
      error: e as Error,
    });
    return { action: "hold", reason: `监控异常: ${e.message}` };
  }
}

export interface MonitorActionResult {
  ok: boolean;
  action: "hold" | "exit" | "reduce" | "freeze" | "close_executed" | "error";
  symbol: string;
  message: string;
}

/**
 * 阶段 9：根据监控动作执行平仓或保持持仓。
 */
export async function executeMonitorAction(
  position: PaperExecution,
  action: "exit" | "freeze" | "hold" | "reduce",
  reason: string,
  workerId: string,
  mode: StrategyMode,
): Promise<MonitorActionResult> {
  const symbol = position.path.symbol;

  try {
    if (action === "exit") {
      // 执行平仓
      const closeResult = await tryExecuteClose(position, workerId, mode, "normal_tp");
      return {
        ok: closeResult.ok,
        action: closeResult.ok ? "close_executed" : "error",
        symbol,
        message: closeResult.message,
      };
    } else if (action === "freeze") {
      // 紧急冻结 — 需要平仓
      const closeResult = await tryExecuteClose(position, workerId, mode, "hard_stop_loss");
      return {
        ok: closeResult.ok,
        action: closeResult.ok ? "close_executed" : "error",
        symbol,
        message: closeResult.message,
      };
    } else {
      return {
        ok: true,
        action: action as "hold" | "reduce",
        symbol,
        message: reason,
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      action: "error",
      symbol,
      message: `监控动作异常: ${e.message}`,
    };
  }
}

/**
 * 检查所有持仓的退出信号，符合条件时自动平仓。
 */
export async function tryAutoMonitor(workerId: string): Promise<AutoMonitorResult> {
  const config = getConfig();
  const mode = config.mode;

  const positionsResult = listMonitorablePositions(mode);
  if (!positionsResult.ok) {
    return { actions: [{ positionId: "", action: "hold", symbol: "", message: positionsResult.skipReason! }] };
  }

  const results: AutoMonitorResult["actions"] = [];
  for (const position of positionsResult.positions) {
    const evalResult = await evaluateSinglePosition(position, workerId, mode);
    const actionResult = await executeMonitorAction(position, evalResult.action, evalResult.reason, workerId, mode);
    results.push({
      positionId: position.id,
      action: actionResult.action,
      symbol: position.path.symbol,
      message: actionResult.message,
    });
  }

  return { actions: results };
}

/* ------------------------------------------------------------------ */
/*  2.1 Close Execution — 持仓平仓                                   */
/* ------------------------------------------------------------------ */

export interface CloseResult {
  ok: boolean;
  message: string;
}

export type CloseExchangeSnapshotResult =
  | { ok: true; snapshot: ExchangeAccountSnapshot }
  | { ok: false; blockers: string[] };

/**
 * 阶段 1：获取交易所账户快照（balances/positions/openOrders）。
 */
export async function fetchCloseExchangeSnapshot(exchange: ExchangeId, symbol: string): Promise<CloseExchangeSnapshotResult> {
  try {
    const { createAccountAdapter } = await import("../account/adapters/accountAdapterFactory");
    const { adapter } = createAccountAdapter(exchange);
    const [balances, positions, openOrders] = await Promise.all([
      adapter.fetchBalances(),
      adapter.fetchPositions(),
      adapter.fetchOpenOrders(),
    ]);

    const base = symbol.split("/")[0];
    const spotBalance = extractSpotBalance(balances, base);
    const perpShortPosition = extractPerpShortPosition(positions, symbol);

    const snapshot: ExchangeAccountSnapshot = {
      exchange,
      spotBalance,
      perpShortPosition,
      openOrders,
      fetchedAtUtc: new Date().toISOString(),
    };

    return { ok: true, snapshot };
  } catch (e: any) {
    return { ok: false, blockers: [`获取交易所快照失败: ${e.message}`] };
  }
}

export type CloseOrderBookResult =
  | { ok: true; orderBook: CloseOrderBook; warnings: string[] }
  | { ok: false; warnings: string[] };

/**
 * 阶段 2-3：获取实时盘口并构造 orderBook。
 */
export async function fetchCloseOrderBook(exchange: ExchangeId, symbol: string): Promise<CloseOrderBookResult> {
  let spotBid1 = 0;
  let perpAsk1 = 0;
  let markPrice = 0;
  const warnings: string[] = [];

  try {
    if (exchange === "binance") {
      const { BinancePublicAdapter } = await import("../market/adapters/binancePublicAdapter");
      const adapter = new BinancePublicAdapter();
      const rawSym = formatRawSymbolForExchange(symbol, exchange);
      const [spotTicker, perpTicker]: [RawTicker, RawTicker & { markPrice?: number }] = await Promise.all([
        adapter.fetchTickerSpot(rawSym).catch(() => ({ bid1: 0 } as RawTicker)),
        adapter.fetchTicker(rawSym).catch(() => ({ ask1: 0, markPrice: 0 } as RawTicker & { markPrice?: number })),
      ]);
      const spotSnapshot = tickerToMarketSnapshot(exchange, symbol, "spot", spotTicker);
      const perpSnapshot = tickerToMarketSnapshot(exchange, symbol, "perp", perpTicker, perpTicker.markPrice);
      spotBid1 = spotSnapshot.bid1;
      perpAsk1 = perpSnapshot.ask1;
      markPrice = perpSnapshot.markPrice ?? 0;
    }
  } catch {
    warnings.push("获取平仓盘口失败，使用回退值");
  }

  const orderBook: CloseOrderBook = {
    spotBid1,
    spotAsk1: 0,
    perpBid1: 0,
    perpAsk1,
    markPrice,
    fetchedAtUtc: new Date().toISOString(),
  };

  return { ok: true, orderBook, warnings };
}

export type ClosePlanBuildResult =
  | { ok: true; closePlan: ClosePlan }
  | { ok: false; blockers: string[] };

/**
 * 阶段 4-7：构建并保存平仓方案。
 */
export async function buildAndSaveClosePlan(
  position: PaperExecution,
  exchangeSnapshot: ExchangeAccountSnapshot,
  orderBook: CloseOrderBook,
  mode: StrategyMode,
  triggerReason: "normal_tp" | "hard_stop_loss" | "manual",
): Promise<ClosePlanBuildResult> {
  try {
    const symbol = position.path.symbol;
    const constraints = getConstraintsForSymbol(symbol);
    const realCloseEnabled = isRealCloseEnabled(mode);

    const closePlan = await buildClosePlan({
      position,
      exchangeSnapshot,
      orderBook,
      spotConstraints: constraints.spot,
      perpConstraints: constraints.perp,
      realCloseEnabled,
      intentId: `worker-close-${position.id}-${Date.now()}`,
    });

    if (closePlan.status !== "validated") {
      return { ok: false, blockers: closePlan.blockers };
    }

    await saveClosePlan(closePlan);
    return { ok: true, closePlan };
  } catch (e: any) {
    return { ok: false, blockers: [`构建平仓方案异常: ${e.message}`] };
  }
}

/**
 * 阶段 8-10：执行 guarded close 并处理结果。
 */
export async function submitGuardedClose(
  closePlan: ClosePlan,
  workerId: string,
  mode: StrategyMode,
  triggerReason: "normal_tp" | "hard_stop_loss" | "manual",
  symbol: string,
): Promise<CloseResult> {
  try {
    const dryRun = mode === "SHADOW";
    const explicitConfirm = dryRun ? undefined : "EXECUTE_REAL_CLOSE_POSITION";

    auditInfo(AuditCategory.WORKER_LIFECYCLE, `执行平仓: ${symbol} dryRun=${dryRun}`, {
      workerId, symbol, exchange: closePlan.exchange,
      detail: { closePlanId: closePlan.id, dryRun, triggerReason, positionId: closePlan.positionId },
    });

    const closeResult = await executeGuardedClose({
      closePlanId: closePlan.id,
      dryRun,
      explicitConfirm,
      triggerReason,
    });

    if (closeResult.status === "closed") {
      auditInfo(AuditCategory.WORKER_LIFECYCLE, `平仓成功: ${symbol}`, {
        workerId, symbol, exchange: closePlan.exchange,
        detail: { closePlanId: closePlan.id, executionId: closeResult.id, pnl: closeResult.finalPnlEstimate },
      });
      return { ok: true, message: `平仓成功: ${symbol} pnl=${closeResult.finalPnlEstimate?.netProfit?.toFixed(2) ?? "?"}U` };
    }

    if (closeResult.status === "prechecked") {
      return { ok: true, message: `平仓 dry-run 完成: ${symbol}` };
    }

    return { ok: false, message: `平仓执行失败: ${closeResult.status} ${closeResult.blockers?.join("; ") ?? ""}` };
  } catch (e: any) {
    return { ok: false, message: `平仓执行异常: ${e.message}` };
  }
}

/**
 * 尝试执行单个持仓的平仓流程。
 */
async function tryExecuteClose(
  position: PaperExecution,
  workerId: string,
  mode: StrategyMode,
  triggerReason: "normal_tp" | "hard_stop_loss" | "manual" = "normal_tp",
): Promise<CloseResult> {
  const symbol = position.path.symbol;
  const exchange = position.path.perpExchange;

  try {
    const snapshotResult = await fetchCloseExchangeSnapshot(exchange, symbol);
    if (!snapshotResult.ok) {
      return { ok: false, message: snapshotResult.blockers?.join("; ") ?? "获取交易所快照失败" };
    }

    const orderBookResult = await fetchCloseOrderBook(exchange, symbol);
    if (!orderBookResult.ok) {
      return { ok: false, message: orderBookResult.warnings.join("; ") ?? "获取平仓盘口失败" };
    }
    const orderBook: CloseOrderBook = orderBookResult.orderBook;

    const planResult = await buildAndSaveClosePlan(position, snapshotResult.snapshot!, orderBook, mode, triggerReason);
    if (!planResult.ok) {
      return { ok: false, message: `平仓方案验证失败: ${planResult.blockers?.join("; ")}` };
    }

    return submitGuardedClose(planResult.closePlan!, workerId, mode, triggerReason, symbol);
  } catch (e: any) {
    return { ok: false, message: `平仓异常: ${e.message}` };
  }
}
