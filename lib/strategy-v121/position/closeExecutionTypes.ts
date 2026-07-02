/**
 * 平仓执行类型定义 — 真实平仓闭环的类型契约。
 *
 * 设计要点：
 * - PaperExecution 仅作为"系统记录"（这笔仓位是谁、从哪来），不作为真实平仓的唯一依据。
 * - 真实可平数量由交易所账户快照决定（ExchangeAccountSnapshot）。
 * - 平仓腿顺序：先永续 BUY 平空 → 再现货 SELL。
 * - PlannedCloseOrderLeg 内部保留 reduceOnly / positionSide 语义标记，
 *   但 binanceAccountAdapter 发请求时按 Hedge/One-way 模式转换，不原样塞给交易所。
 * - 状态机：prechecked → perp_submitted → perp_filled → spot_submitted → spot_filled → closed。
 *   任何失败/未知/部分成交/验证失败 → protected（position FROZEN）或 failed（position 保持/冻结）。
 */
import type { ExchangeId } from "../domain/types";
import type { ExchangeOrderSubmissionResult, ExchangeOrderStatus } from "../execution/orderExecutionTypes";
import type { AccountBalanceSnapshot, AccountPositionSnapshot, OpenOrderSnapshot } from "../account/accountTypes";

// ── 平仓腿角色 ──────────────────────────────────────────────
export type CloseLegRole = "spot_sell" | "perp_buy_close";

// ── 平仓方案状态 ─────────────────────────────────────────────
export type ClosePlanStatus = "validated" | "blocked" | "stale";

// ── 平仓执行状态（可审计，用户界面只显示中文）──────────────────
export type CloseExecutionStatus =
  | "prechecked"      // 执行前校验通过（dry-run）
  | "perp_submitted"  // 永续平空已提交
  | "perp_filled"     // 永续平空确认成交
  | "spot_submitted"  // 现货卖出已提交
  | "spot_filled"     // 现货卖出确认成交
  | "closed"          // 双腿成交 + 平仓后验证通过 + position CLOSED
  | "protected"       // 未知/部分成交/验证失败 → position FROZEN（保护状态）
  | "failed";         // 明确拒绝（REJECTED）

// ── 平仓腿（内部语义标记，adapter 发请求时按模式转换）──────────
export interface PlannedCloseOrderLeg {
  role: CloseLegRole;
  exchange: ExchangeId;
  symbol: string;
  market: "spot" | "perp";
  side: "BUY" | "SELL";
  type: "MARKET";
  quantity: number;            // 真实可平数量（min(系统记录, 交易所实际)）
  quoteNotionalUsdt: number;   // quantity × estimatedPrice
  estimatedPrice: number;
  clientOrderId: string;
  /** 语义标记：平仓腿应为 reduce-only。adapter 按持仓模式转换。 */
  reduceOnly: true;
  /** 语义标记：平空 SHORT 腿。Hedge Mode 下发送 positionSide=SHORT。 */
  positionSide?: "SHORT";
  constraints: {
    minQty?: number;
    stepSize?: number;
    minNotional?: number;
    tickSize?: number;
  };
}

// ── 交易所账户快照（真实数据，ground truth）────────────────────
export interface ExchangeAccountSnapshot {
  exchange: ExchangeId;
  spotBalance: AccountBalanceSnapshot | null;       // 现货余额（free = 可卖出量）
  perpShortPosition: AccountPositionSnapshot | null; // 永续 SHORT 仓位（quantity = |positionAmt|）
  openOrders: OpenOrderSnapshot[];                  // 当前挂单
  fetchedAtUtc: string;
}

// ── 当前盘口 ─────────────────────────────────────────────────
export interface CloseOrderBook {
  spotBid1: number;   // 现货买一（卖出成交价估算）
  spotAsk1: number;
  perpBid1: number;
  perpAsk1: number;   // 永续卖一（BUY 平空成交价估算）
  markPrice: number;
  fetchedAtUtc: string;
}

// ── 风控状态快照 ─────────────────────────────────────────────
export interface CloseRiskState {
  killSwitch: string;
  freezeLevel: "none" | "level1" | "level2";
}

// ── 平仓方案 ─────────────────────────────────────────────────
export interface ClosePlan {
  id: string;
  positionId: string;
  exchange: ExchangeId;
  symbol: string;
  perpLeg: PlannedCloseOrderLeg;   // 永续 BUY 平空
  spotLeg: PlannedCloseOrderLeg;   // 现货 SELL
  status: ClosePlanStatus;
  blockers: string[];
  warnings: string[];
  /** 系统记录数量（PaperExecution.spotFilledQty/perpFilledQty） */
  systemRecordQty: { spot: number; perp: number };
  /** 交易所真实可平数量 */
  exchangeActualQty: { spot: number; perp: number };
  /** 最终采用的可平数量 = min(系统记录, 交易所真实) */
  closeQty: { spot: number; perp: number };
  createdAtUtc: string;
  expiresAtUtc: string;            // 60 秒 TTL
  /** 真实平仓门控是否开启（V121_ENABLE_REAL_CLOSE_EXECUTION=1） */
  realCloseEnabled: boolean;
}

// ── 平仓收益估算 ─────────────────────────────────────────────
export interface ClosePnlEstimate {
  fundingProfit: number;        // 已实现资金费收益
  openBasisImpact: number;      // 开仓基差影响
  closeBasisImpact: number;     // 平仓基差影响
  fees: number;                 // 手续费
  slippage: number;             // 滑点估算
  netProfit: number;            // 最终净收益
}

// ── 平仓后验证结果 ───────────────────────────────────────────
export interface CloseVerificationResult {
  perpShortCleared: boolean;    // 永续 SHORT 仓位 ≈ 0
  spotBalanceReduced: boolean;  // 现货余额已减少
  executedQtyMatched: boolean;  // executedQty ≈ 计划量
  perpRemainingQty: number;     // 永续剩余仓位
  spotRemainingFree: number;    // 现货剩余 free 余额
  differences: string[];        // 验证差异描述
}

// ── 平仓执行结果 ─────────────────────────────────────────────
export interface CloseExecutionResult {
  ok: boolean;
  id: string;
  positionId: string;
  closePlanId: string;
  exchange: ExchangeId;
  symbol: string;
  status: CloseExecutionStatus;
  perpCloseOrder?: ExchangeOrderSubmissionResult;
  spotCloseOrder?: ExchangeOrderSubmissionResult;
  blockers: string[];
  warnings: string[];
  frozenReason?: string;
  finalPnlEstimate?: ClosePnlEstimate;
  verification?: CloseVerificationResult;
  createdAtUtc: string;
  updatedAtUtc: string;
}

// ── 用户可见确认串（产品词）vs 后端确认串（工程词）──────────────
export const USER_CONFIRM_CLOSE = "CONFIRM_CLOSE_POSITION";
export const BACKEND_CONFIRM_CLOSE = "EXECUTE_REAL_CLOSE_POSITION";

// ── 平仓执行状态 → 中文展示 ──────────────────────────────────
export const CLOSE_STATUS_LABEL: Record<CloseExecutionStatus, string> = {
  prechecked: "校验通过",
  perp_submitted: "平仓处理中",
  perp_filled: "平仓处理中",
  spot_submitted: "平仓处理中",
  spot_filled: "平仓处理中",
  closed: "已平仓",
  protected: "已暂停保护",
  failed: "平仓失败",
};

// ── PaperState → 中文展示（持仓页/平仓页共用）─────────────────
export const POSITION_STATE_LABEL: Record<string, string> = {
  OPEN: "持仓中",
  MONITORING: "持仓中",
  EXITING: "平仓处理中",
  CLOSED: "已平仓",
  FROZEN: "已暂停保护",
  FAILED: "开仓失败",
  IDLE: "待开仓",
  PRECHECK: "开仓校验中",
  SHORT_LEG: "已暂停保护",
};

// ── 复用 ExchangeOrderStatus 的子集用于 close leg 结果 ─────────
export type { ExchangeOrderStatus };
