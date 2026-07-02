import type { ExchangeId } from "./types";
import path from "node:path";

/** 项目数据持久化根目录 */
export const DATA_DIR = path.join(process.cwd(), ".v121-data");

export const ALLOWED_EXCHANGES: ExchangeId[] = ["binance", "okx", "htx"];

export const BATCH_RATIOS = [0.3, 0.3, 0.4] as const;

/**
 * V1 资金费阈值（向后兼容）
 */
export const FUNDING_THRESHOLDS = {
  MIN_FUNDING_8H: 0.0005,         // 0.05%
  QUALITY_FUNDING_8H: 0.001,      // 0.10%
  ABNORMAL_FUNDING_8H: 0.003,     // 0.30%
  BLOCK_FUNDING_8H: 0.005,       // 0.50%
  BLACKLIST_FUNDING_8H: 0.01,    // 1.00%
} as const;

/**
 * V1 旧阈值（向后兼容）
 */
export const VOLUME_THRESHOLDS = {
  MIN_SPOT_VOLUME_24H: 200_000,       // 200k USDT
  MIN_PERP_VOLUME_24H: 1_000_000,     // 1M USDT
} as const;

export const DEPTH_THRESHOLDS = {
  SPOT_SELL_DEPTH_FACTOR: 3,    // 计划仓位 × 3
  PERP_BUY_DEPTH_FACTOR: 5,     // 计划仓位 × 5
  DEPTH_CHECK_PERCENT: 0.003,   // 0.3%
} as const;

export const SPREAD_THRESHOLDS = {
  MAX_SPOT_SPREAD: 0.001,       // 0.10%
  MAX_PERP_SPREAD: 0.0008,      // 0.08%
  WIDE_SPREAD_TRIGGER: 0.003,   // 0.30%
} as const;

export const DEVIATION_LIMITS = {
  NORMAL: 0.01,     // 1%
  REPAIR: 0.03,     // 3%
  PAUSE: 0.05,      // 5%
} as const;

export const NET_PROFIT_THRESHOLDS: Record<string, number> = {
  "binance:binance": 0.004,      // 0.40%
  "okx:okx": 0.004,             // 0.40%
  "binance:okx": 0.005,         // 0.50%
  "okx:binance": 0.005,         // 0.50%
  "htx:htx": 0.006,             // 0.60%
  "binance:htx": 0.007,         // 0.70%
  "htx:binance": 0.007,         // 0.70%
  "okx:htx": 0.007,             // 0.70%
  "htx:okx": 0.007,             // 0.70%
};

export const STOP_LOSS = {
  TINY: 0.002,       // 0.2% — MAINNET_TINY
  CONTROLLED: 0.003,  // 0.3% — CONTROLLED_LIVE
  MATURE: 0.005,     // 0.5%
} as const;

export const DRAWDOWN_LIMITS = {
  HALVE: 0.03,        // 3% 仓位减半
  PAUSE_NEW: 0.05,    // 5% 暂停新开仓
  REDUCE: 0.08,       // 8% 主动减仓
  CLEAR: 0.10,        // 10% 清空
} as const;

export const TIME_LIMITS = {
  EXIT_NO_PROFIT: 24,     // 24h
  FORCE_REVIEW: 48,       // 48h
  FORCE_EXIT: 72,         // 72h
  MAX_HTX_HOLD: 24,       // 24h for HTX / small coins
} as const;

export const COOLDOWN = {
  ENTRY_FAILURE: 30,         // 30 min
  NORMAL_EXIT: 10,           // 10 min
  RISK_EXIT: 60,             // 60 min
  STOP_LOSS_EXIT: 1440,      // 24h
  EXCHANGE_ANOMALY: 30,      // 30 min
} as const;

/**
 * V2 资金规划方案
 */
export const CAPITAL_PLANS = {
  /** 同所标准版（推荐） */
  SAME_EXCHANGE_STANDARD: {
    spotRatio: 0.30,
    shortNotionalRatio: 0.30,
    perpMarginBufferRatio: 0.30,
    reserveRatio: 0.10,
  },
  /** 跨所保守版 */
  CROSS_EXCHANGE_CONSERVATIVE: {
    spotRatio: 0.25,
    shortNotionalRatio: 0.25,
    perpMarginBufferRatio: 0.35,
    reserveRatio: 0.15,
  },
  /** 极端保守版 */
  EXTREME_CONSERVATIVE: {
    spotRatio: 0.20,
    shortNotionalRatio: 0.20,
    perpMarginBufferRatio: 0.50,
    reserveRatio: 0.10,
  },
} as const;

/**
 * V2 风控 — 强平距离阈值
 */
export const LIQUIDATION_THRESHOLDS = {
  /** 警告 */
  WARNING_PCT: 0.50,
  /** 减仓 */
  REDUCE_PCT: 0.35,
  /** 强制平一半 */
  FORCE_HALF_PCT: 0.25,
  /** 全部退出 */
  FORCE_EXIT_PCT: 0.15,
  /** 山寨币警告更严格 */
  WARNING_PCT_ALT: 0.60,
  REDUCE_PCT_ALT: 0.45,
  FORCE_EXIT_PCT_ALT: 0.30,
} as const;

/**
 * V2 单币仓位上限
 */
export const POSITION_LIMITS = {
  /** 核心池单币上限 */
  CORE_MAX_PCT: 0.10,
  /** 机会池单币上限 */
  OPPORTUNITY_MAX_PCT: 0.05,
  /** 观察池单币上限 */
  WATCH_MAX_PCT: 0.02,
  /** 合约账户保证金使用率上限 */
  MAX_MARGIN_USAGE: 0.50,
  /** 同方向总空单名义上限 */
  MAX_TOTAL_SHORT_NOTIONAL_PCT: 0.50,
} as const;

/**
 * V2 新上线天数过滤
 */
export const NEW_LISTING_DAYS = 7;
