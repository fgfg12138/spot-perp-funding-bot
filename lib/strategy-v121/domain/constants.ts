import type { ExchangeId } from "./types";

export const ALLOWED_EXCHANGES: ExchangeId[] = ["binance", "okx", "htx"];

export const BATCH_RATIOS = [0.3, 0.3, 0.4] as const;

export const FUNDING_THRESHOLDS = {
  MIN_FUNDING_8H: 0.0005,         // 0.05%
  QUALITY_FUNDING_8H: 0.001,      // 0.10%
  ABNORMAL_FUNDING_8H: 0.003,     // 0.30%
  BLOCK_FUNDING_8H: 0.005,       // 0.50%
  BLACKLIST_FUNDING_8H: 0.01,    // 1.00%
} as const;

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
