import type { StrategyMode, ExchangeId } from "../domain/types";

export interface StrategyConfig {
  mode: StrategyMode;
  enabledExchanges: ExchangeId[];
  plannedNotional: number;
  phase: "test" | "stable" | "mature";
  makerRate: number;
  takerRate: number;
  maxDataAgeMs: number;
  blacklist: string[];
  whitelist: string[];
}

export const DEFAULT_CONFIG: StrategyConfig = {
  mode: "READ_ONLY",
  enabledExchanges: ["binance", "okx", "htx"],
  plannedNotional: 10000,
  phase: "test",
  makerRate: 0.0002,
  takerRate: 0.0007,
  maxDataAgeMs: 10000,
  blacklist: [],
  whitelist: [],
};

let currentConfig: StrategyConfig = { ...DEFAULT_CONFIG };

export function getConfig(): StrategyConfig {
  return { ...currentConfig };
}

export function updateConfig(partial: Partial<StrategyConfig>): StrategyConfig {
  currentConfig = { ...currentConfig, ...partial };
  return getConfig();
}
