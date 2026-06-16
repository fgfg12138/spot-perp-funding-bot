import type { StrategyMode, ExchangeId } from "../domain/types";

export interface StrategyConfig {
  mode: StrategyMode;
  enabledExchanges: ExchangeId[];
  plannedNotional: number;
  phase: "tiny" | "controlled" | "mature";
  makerRate: number;
  takerRate: number;
  maxDataAgeMs: number;
  blacklist: string[];
  whitelist: string[];
  killSwitch: "OFF" | "READ_ONLY_ONLY" | "PAUSE_NEW_ENTRIES" | "PAUSE_ALL_AUTOMATION";
}

export const DEFAULT_CONFIG: StrategyConfig = {
  mode: (process.env.V121_MODE as StrategyMode) ?? "READ_ONLY",
  enabledExchanges: ["binance", "okx", "htx"],
  plannedNotional: 10000,
  phase: "tiny",
  makerRate: 0.0002,
  takerRate: 0.0007,
  maxDataAgeMs: 10000,
  blacklist: [],
  whitelist: [],
  killSwitch: "OFF",
};

let currentConfig: StrategyConfig = { ...DEFAULT_CONFIG };

export function getConfig(): StrategyConfig {
  return { ...currentConfig };
}

export function updateConfig(partial: Partial<StrategyConfig>): StrategyConfig {
  currentConfig = { ...currentConfig, ...partial };
  return getConfig();
}

// ─── MAINNET_TINY 默认限制 ──────────────────────

export const MAINNET_TINY_DEFAULT_LIMITS = {
  maxOrderNotionalUsdt: 10,
  maxTotalExposureUsdt: 50,
  maxDailyTrades: 3,
  maxSingleSymbolEquityRatio: 0.005,
  maxTotalEquityRatio: 0.03,
  maxDailyLossEquityRatio: 0.002,
  leverage: 1,
  allowHtx: false,
  allowSmallCaps: false,
  allowCrossExchange: false,
  requireManualConfirm: true,
  allowAutoEntry: false,
  allowRiskExit: true,
} as const;

// ─── CONTROLLED_LIVE 默认限制 ────────────────────

export const CONTROLLED_LIVE_DEFAULT_LIMITS = {
  maxSingleSymbolEquityRatio: 0.03,
  maxTotalEquityRatio: 0.30,
  leverage: 1,
  allowHtx: false,
  allowSmallCaps: false,
  requireManualConfirm: true,
  allowAutoEntry: false,
  allowRiskExit: true,
} as const;

// ─── 模式安全门 ──────────────────────────────────

export const MODE_REQUIREMENTS: Record<StrategyMode, { envVars: string[]; disallowOrder: boolean }> = {
  READ_ONLY:        { envVars: [],                                                disallowOrder: true },
  PAPER:            { envVars: [],                                                disallowOrder: true },
  SHADOW:           { envVars: ["V121_MODE=SHADOW"],                              disallowOrder: true },
  MAINNET_TINY:     { envVars: ["V121_MODE=MAINNET_TINY", "V121_MAINNET_TINY_ENABLED=true", "V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND"], disallowOrder: false },
  CONTROLLED_LIVE:  { envVars: ["V121_MODE=CONTROLLED_LIVE", "V121_LIVE_ENABLED=true", "V121_CONFIRM_LIVE_RISK=I_UNDERSTAND"], disallowOrder: false },
};

/**
 * Check if a mode is allowed to place real orders.
 */
export function canPlaceRealOrders(mode: StrategyMode, envVars: Record<string, string | undefined>): boolean {
  const req = MODE_REQUIREMENTS[mode];
  if (!req || req.disallowOrder) return false;
  if (mode === "SHADOW") return false;

  // Check all required environment variables are present
  for (const envReq of req.envVars) {
    const [key, expected] = envReq.split("=");
    if (envVars[key] !== expected) return false;
  }

  return true;
}

