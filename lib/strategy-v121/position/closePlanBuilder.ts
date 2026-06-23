/**
 * 平仓方案生成 — 以交易所账户快照为 ground truth 构造 ClosePlan。
 *
 * 核心原则（用户强制修正 #1）：
 * - PaperExecution 仅是"系统记录"，不作为真实平仓的唯一依据。
 * - 真实可平数量 = min(系统记录数量, 交易所实际数量)。
 *   系统记录 > 交易所实际：交易所为准（可能部分已被手动平掉）。
 *   系统记录 < 交易所实际：系统记录为准（只平我们开的仓，不动账户其余仓位）。
 * - 两条腿各自 floor 到 stepSize，再校验 minNotional / 数量 > 0。
 *
 * 不查盘口、不下单 — 只产出方案与 blockers/warnings，持久化由调用方负责。
 */
import type { PaperExecution } from "../execution/paperLifecycle";
import type { ExchangeId } from "../domain/types";
import type {
  ClosePlan,
  ClosePlanStatus,
  PlannedCloseOrderLeg,
  ExchangeAccountSnapshot,
  CloseOrderBook,
} from "./closeExecutionTypes";

function makeId(): string {
  return `cplan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeIntentId(raw?: string): string {
  if (!raw) return "manual";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
}

function makeClientOrderId(input: {
  prefix: "v121c";
  role: "spot" | "perp";
  intentId?: string;
  timestampMs: number;
}): string {
  const intentPart = sanitizeIntentId(input.intentId);
  return `${input.prefix}_${input.role}_${intentPart}_${input.timestampMs}`.slice(0, 36);
}

function floorToStep(value: number, stepSize?: number): number {
  if (!stepSize || stepSize <= 0) return value;
  return Math.floor(value / stepSize) * stepSize;
}

function qtyAlmostEqual(a: number, b: number, eps = 1e-8): boolean {
  return Math.abs(a - b) < eps;
}

export interface BuildClosePlanInput {
  /** 系统记录仓位（PaperExecution）。 */
  position: PaperExecution;
  /** 交易所账户快照（真实数据，ground truth）。 */
  exchangeSnapshot: ExchangeAccountSnapshot;
  /** 当前盘口（用于估算成交价与 quoteNotional）。 */
  orderBook: CloseOrderBook;
  /** 现货交易约束（minQty/stepSize/minNotional/tickSize）。 */
  spotConstraints: { minQty?: number; stepSize?: number; minNotional?: number; tickSize?: number };
  /** 永续交易约束。 */
  perpConstraints: { minQty?: number; stepSize?: number; minNotional?: number; tickSize?: number };
  /** 真实平仓门控是否开启（V121_ENABLE_REAL_CLOSE_EXECUTION=1）。 */
  realCloseEnabled: boolean;
  /** 可选 intentId（用于 clientOrderId 追溯）。 */
  intentId?: string;
}

/**
 * 生成平仓方案。
 *
 * 平仓腿顺序：先永续 BUY 平空 → 再现货 SELL。
 * 但本函数只构造两条腿的方案对象，不下单；执行顺序由 guardedCloseExecutor 控制。
 */
export async function buildClosePlan(input: BuildClosePlanInput): Promise<ClosePlan> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const ts = Date.now();
  const id = makeId();
  const pos = input.position;
  const snap = input.exchangeSnapshot;
  const ob = input.orderBook;
  const exchange: ExchangeId = pos.path.perpExchange;

  // ── 系统记录数量 ──────────────────────────────────
  const systemRecordQty = {
    spot: pos.spotFilledQty,
    perp: pos.perpFilledQty,
  };

  // ── 交易所真实数量（ground truth）──────────────────
  const exchangeActualQty = {
    spot: snap.spotBalance?.free ?? 0,
    perp: snap.perpShortPosition?.quantity ?? 0,
  };

  // ── 可平数量 = min(系统记录, 交易所真实) ──────────
  // spot: 现货可卖量 = min(系统记录买入量, 交易所 free 余额)
  // perp: 永续可平空量 = min(系统记录开空量, 交易所 SHORT 仓位量)
  const rawSpotCloseQty = Math.min(systemRecordQty.spot, exchangeActualQty.spot);
  const rawPerpCloseQty = Math.min(systemRecordQty.perp, exchangeActualQty.perp);

  // floor 到 step
  const spotCloseQty = floorToStep(rawSpotCloseQty, input.spotConstraints.stepSize);
  const perpCloseQty = floorToStep(rawPerpCloseQty, input.perpConstraints.stepSize);

  // 估算成交价：现货卖用 bid1，永续 BUY 平空用 ask1
  const spotEstPrice = ob.spotBid1 > 0 ? ob.spotBid1 : 0;
  const perpEstPrice = ob.perpAsk1 > 0 ? ob.perpAsk1 : ob.markPrice > 0 ? ob.markPrice : 0;

  const spotNotional = spotCloseQty * spotEstPrice;
  const perpNotional = perpCloseQty * perpEstPrice;

  // ── 校验 ──────────────────────────────────────────
  if (spotCloseQty <= 0) blockers.push("spot close qty <= 0 after min(system,exchange) and step rounding");
  if (perpCloseQty <= 0) blockers.push("perp close qty <= 0 after min(system,exchange) and step rounding");

  const spotMinNotional = input.spotConstraints.minNotional ?? 0;
  const perpMinNotional = input.perpConstraints.minNotional ?? 0;
  if (spotCloseQty > 0 && spotNotional < spotMinNotional) {
    blockers.push(`spot close notional ${spotNotional.toFixed(4)} < minNotional ${spotMinNotional}`);
  }
  if (perpCloseQty > 0 && perpNotional < perpMinNotional) {
    blockers.push(`perp close notional ${perpNotional.toFixed(4)} < minNotional ${perpMinNotional}`);
  }

  // 数量差异警告：系统记录与交易所不一致（不影响 block，但提示人工关注）
  if (!qtyAlmostEqual(systemRecordQty.spot, exchangeActualQty.spot)) {
    warnings.push(
      `spot qty differs: system=${systemRecordQty.spot}, exchange=${exchangeActualQty.spot}`,
    );
  }
  if (!qtyAlmostEqual(systemRecordQty.perp, exchangeActualQty.perp)) {
    warnings.push(
      `perp qty differs: system=${systemRecordQty.perp}, exchange=${exchangeActualQty.perp}`,
    );
  }

  if (spotEstPrice <= 0) warnings.push("spot bid1 missing, price estimate unreliable");
  if (perpEstPrice <= 0) warnings.push("perp ask1/mark missing, price estimate unreliable");

  // ── 构造两腿 ──────────────────────────────────────
  const perpLeg: PlannedCloseOrderLeg = {
    role: "perp_buy_close",
    exchange,
    symbol: pos.path.symbol,
    market: "perp",
    side: "BUY",
    type: "MARKET",
    quantity: perpCloseQty,
    quoteNotionalUsdt: perpNotional,
    estimatedPrice: perpEstPrice,
    clientOrderId: makeClientOrderId({ prefix: "v121c", role: "perp", intentId: input.intentId, timestampMs: ts }),
    reduceOnly: true,
    positionSide: "SHORT",
    constraints: input.perpConstraints,
  };

  const spotLeg: PlannedCloseOrderLeg = {
    role: "spot_sell",
    exchange,
    symbol: pos.path.symbol,
    market: "spot",
    side: "SELL",
    type: "MARKET",
    quantity: spotCloseQty,
    quoteNotionalUsdt: spotNotional,
    estimatedPrice: spotEstPrice,
    clientOrderId: makeClientOrderId({ prefix: "v121c", role: "spot", intentId: input.intentId, timestampMs: ts + 1 }),
    reduceOnly: true,
    constraints: input.spotConstraints,
  };

  const status: ClosePlanStatus = blockers.length === 0 ? "validated" : "blocked";

  return {
    id,
    positionId: pos.id,
    exchange,
    symbol: pos.path.symbol,
    perpLeg,
    spotLeg,
    status,
    blockers,
    warnings,
    systemRecordQty,
    exchangeActualQty,
    closeQty: { spot: spotCloseQty, perp: perpCloseQty },
    createdAtUtc: now,
    expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    realCloseEnabled: input.realCloseEnabled,
  };
}
