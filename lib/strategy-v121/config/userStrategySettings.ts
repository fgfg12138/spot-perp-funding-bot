import { getRepository } from "../persistence/repositoryFactory";

export type TransferMode = "disabled" | "suggest_only" | "auto_transfer";
export type SettingsScanMode = "fixed_universe" | "dynamic_same_exchange";

export interface UserStrategySettings {
  funding: {
    minFundingRate8h: number;
    abnormalFundingRate8h: number;
    blockFundingRate8h: number;
    blacklistFundingRate8h: number;
    minNetProfitRate: number;
    minSecondsToFunding: number;
    maxSecondsToFunding?: number;
  };
  notional: {
    plannedNotionalUsdt: number;
    maxOrderNotionalUsdt: number;
    maxSymbolExposureUsdt: number;
    maxExchangeExposureUsdt: number;
    maxDailyTrades: number;
    maxDailyNotionalUsdt: number;
    allowAutoDownsize: boolean;
    minExecutionNotionalUsdt: number;
  };
  capital: {
    globalReserveRate: number;
    minGlobalReserveUsdt: number;
    spotBufferRate: number;
    perpBufferRate: number;
  };
  transfer: {
    allowAutoTransfer: boolean;
    mode: TransferMode;
    maxAutoTransferUsdt: number;
    allowSpotToPerp: boolean;
    allowPerpToSpot: boolean;
    requireReauditAfterTransfer: true;
    balanceRefreshDelayMs: number;
    balanceRefreshRetries: number;
  };
  universe: {
    useDynamicUniverse: boolean;
    scanMode: SettingsScanMode;
    maxDynamicSymbolsPerExchange: number;
    minSpotVolume24hUsdt: number;
    minPerpVolume24hUsdt: number;
    allowSmallCaps: boolean;
    symbolWhitelist: string[];
    symbolBlacklist: string[];
    prioritySymbols: string[];
    allowHtxTiny: false;
  };
  risk: {
    maxSpotSpreadRate: number;
    maxPerpSpreadRate: number;
    wideSpreadTriggerRate: number;
    depthCheckPercent: number;
    spotDepthFactor: number;
    perpDepthFactor: number;
    maxMarkIndexDeviationRate: number;
    minListedHours: number;
  };
  execution: {
    requireHumanApproval: true;
    allowRealOrders: boolean;
    allowAutoOrderAfterTransfer: false;
    maxLegDeviationRate: number;
    orderTimeoutMs: number;
    freezeOnUnknownOrder: true;
    freezeOnUnknownTransfer: true;
    blockWhenOpenOrdersExist: boolean;
    blockWhenSameSymbolPositionExists: boolean;
  };
}

export const DEFAULT_USER_STRATEGY_SETTINGS: UserStrategySettings = {
  funding: {
    minFundingRate8h: 0.0005,
    abnormalFundingRate8h: 0.003,
    blockFundingRate8h: 0.005,
    blacklistFundingRate8h: 0.01,
    minNetProfitRate: 0.004,
    minSecondsToFunding: 300,
  },
  notional: {
    plannedNotionalUsdt: 10,
    maxOrderNotionalUsdt: 50,
    maxSymbolExposureUsdt: 50,
    maxExchangeExposureUsdt: 100,
    maxDailyTrades: 3,
    maxDailyNotionalUsdt: 150,
    allowAutoDownsize: true,
    minExecutionNotionalUsdt: 10,
  },
  capital: {
    globalReserveRate: 0.2,
    minGlobalReserveUsdt: 10,
    spotBufferRate: 0.015,
    perpBufferRate: 0.035,
  },
  transfer: {
    allowAutoTransfer: false,
    mode: "disabled",
    maxAutoTransferUsdt: 50,
    allowSpotToPerp: true,
    allowPerpToSpot: true,
    requireReauditAfterTransfer: true,
    balanceRefreshDelayMs: 1500,
    balanceRefreshRetries: 3,
  },
  universe: {
    useDynamicUniverse: false,
    scanMode: "fixed_universe",
    maxDynamicSymbolsPerExchange: 80,
    minSpotVolume24hUsdt: 200_000,
    minPerpVolume24hUsdt: 1_000_000,
    allowSmallCaps: false,
    symbolWhitelist: [],
    symbolBlacklist: [],
    prioritySymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT", "BNB/USDT", "ADA/USDT", "AVAX/USDT", "LINK/USDT", "SUI/USDT"],
    allowHtxTiny: false,
  },
  risk: {
    maxSpotSpreadRate: 0.001,
    maxPerpSpreadRate: 0.0008,
    wideSpreadTriggerRate: 0.003,
    depthCheckPercent: 0.003,
    spotDepthFactor: 3,
    perpDepthFactor: 5,
    maxMarkIndexDeviationRate: 0.05,
    minListedHours: 24,
  },
  execution: {
    requireHumanApproval: true,
    allowRealOrders: false,
    allowAutoOrderAfterTransfer: false,
    maxLegDeviationRate: 0.01,
    orderTimeoutMs: 10_000,
    freezeOnUnknownOrder: true,
    freezeOnUnknownTransfer: true,
    blockWhenOpenOrdersExist: true,
    blockWhenSameSymbolPositionExists: true,
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings(base: UserStrategySettings, patch: DeepPartial<UserStrategySettings>): UserStrategySettings {
  const out: any = structuredCloneSafe(base);
  for (const [sectionKey, sectionPatch] of Object.entries(patch as Record<string, unknown>)) {
    if (!isRecord(sectionPatch) || !isRecord(out[sectionKey])) continue;
    out[sectionKey] = { ...out[sectionKey], ...sectionPatch };
  }
  return normalizeUserStrategySettings(out);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(value, fallback, min, max));
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function strArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean);
  return [];
}

export function normalizeUserStrategySettings(input: DeepPartial<UserStrategySettings> = {}): UserStrategySettings {
  const base = structuredCloneSafe(DEFAULT_USER_STRATEGY_SETTINGS);
  const raw = mergePlain(base, input) as UserStrategySettings;

  const settings: UserStrategySettings = {
    funding: {
      minFundingRate8h: num(raw.funding?.minFundingRate8h, base.funding.minFundingRate8h, 0, 0.02),
      abnormalFundingRate8h: num(raw.funding?.abnormalFundingRate8h, base.funding.abnormalFundingRate8h, 0, 0.05),
      blockFundingRate8h: num(raw.funding?.blockFundingRate8h, base.funding.blockFundingRate8h, 0, 0.1),
      blacklistFundingRate8h: num(raw.funding?.blacklistFundingRate8h, base.funding.blacklistFundingRate8h, 0, 0.2),
      minNetProfitRate: num(raw.funding?.minNetProfitRate, base.funding.minNetProfitRate, 0, 0.05),
      minSecondsToFunding: int(raw.funding?.minSecondsToFunding, base.funding.minSecondsToFunding, 0, 86_400),
      maxSecondsToFunding: raw.funding?.maxSecondsToFunding === undefined ? undefined : int(raw.funding.maxSecondsToFunding, 28_800, 0, 172_800),
    },
    notional: {
      plannedNotionalUsdt: num(raw.notional?.plannedNotionalUsdt, base.notional.plannedNotionalUsdt, 1, 1_000_000),
      maxOrderNotionalUsdt: num(raw.notional?.maxOrderNotionalUsdt, base.notional.maxOrderNotionalUsdt, 1, 1_000_000),
      maxSymbolExposureUsdt: num(raw.notional?.maxSymbolExposureUsdt, base.notional.maxSymbolExposureUsdt, 1, 10_000_000),
      maxExchangeExposureUsdt: num(raw.notional?.maxExchangeExposureUsdt, base.notional.maxExchangeExposureUsdt, 1, 100_000_000),
      maxDailyTrades: int(raw.notional?.maxDailyTrades, base.notional.maxDailyTrades, 1, 10_000),
      maxDailyNotionalUsdt: num(raw.notional?.maxDailyNotionalUsdt, base.notional.maxDailyNotionalUsdt, 1, 100_000_000),
      allowAutoDownsize: bool(raw.notional?.allowAutoDownsize, base.notional.allowAutoDownsize),
      minExecutionNotionalUsdt: num(raw.notional?.minExecutionNotionalUsdt, base.notional.minExecutionNotionalUsdt, 1, 1_000_000),
    },
    capital: {
      globalReserveRate: num(raw.capital?.globalReserveRate, base.capital.globalReserveRate, 0, 0.95),
      minGlobalReserveUsdt: num(raw.capital?.minGlobalReserveUsdt, base.capital.minGlobalReserveUsdt, 0, 1_000_000),
      spotBufferRate: num(raw.capital?.spotBufferRate, base.capital.spotBufferRate, 0, 0.5),
      perpBufferRate: num(raw.capital?.perpBufferRate, base.capital.perpBufferRate, 0, 0.5),
    },
    transfer: {
      allowAutoTransfer: bool(raw.transfer?.allowAutoTransfer, base.transfer.allowAutoTransfer),
      mode: raw.transfer?.mode === "suggest_only" || raw.transfer?.mode === "auto_transfer" ? raw.transfer.mode : "disabled",
      maxAutoTransferUsdt: num(raw.transfer?.maxAutoTransferUsdt, base.transfer.maxAutoTransferUsdt, 1, 1_000_000),
      allowSpotToPerp: bool(raw.transfer?.allowSpotToPerp, base.transfer.allowSpotToPerp),
      allowPerpToSpot: bool(raw.transfer?.allowPerpToSpot, base.transfer.allowPerpToSpot),
      requireReauditAfterTransfer: true,
      balanceRefreshDelayMs: int(raw.transfer?.balanceRefreshDelayMs, base.transfer.balanceRefreshDelayMs, 0, 60_000),
      balanceRefreshRetries: int(raw.transfer?.balanceRefreshRetries, base.transfer.balanceRefreshRetries, 0, 20),
    },
    universe: {
      useDynamicUniverse: bool(raw.universe?.useDynamicUniverse, base.universe.useDynamicUniverse),
      scanMode: raw.universe?.scanMode === "dynamic_same_exchange" ? "dynamic_same_exchange" : "fixed_universe",
      maxDynamicSymbolsPerExchange: int(raw.universe?.maxDynamicSymbolsPerExchange, base.universe.maxDynamicSymbolsPerExchange, 1, 500),
      minSpotVolume24hUsdt: num(raw.universe?.minSpotVolume24hUsdt, base.universe.minSpotVolume24hUsdt, 0, 1_000_000_000_000),
      minPerpVolume24hUsdt: num(raw.universe?.minPerpVolume24hUsdt, base.universe.minPerpVolume24hUsdt, 0, 1_000_000_000_000),
      allowSmallCaps: bool(raw.universe?.allowSmallCaps, base.universe.allowSmallCaps),
      symbolWhitelist: strArray(raw.universe?.symbolWhitelist),
      symbolBlacklist: strArray(raw.universe?.symbolBlacklist),
      prioritySymbols: strArray(raw.universe?.prioritySymbols).length > 0 ? strArray(raw.universe?.prioritySymbols) : base.universe.prioritySymbols,
      allowHtxTiny: false,
    },
    risk: {
      maxSpotSpreadRate: num(raw.risk?.maxSpotSpreadRate, base.risk.maxSpotSpreadRate, 0, 0.2),
      maxPerpSpreadRate: num(raw.risk?.maxPerpSpreadRate, base.risk.maxPerpSpreadRate, 0, 0.2),
      wideSpreadTriggerRate: num(raw.risk?.wideSpreadTriggerRate, base.risk.wideSpreadTriggerRate, 0, 0.5),
      depthCheckPercent: num(raw.risk?.depthCheckPercent, base.risk.depthCheckPercent, 0, 0.2),
      spotDepthFactor: num(raw.risk?.spotDepthFactor, base.risk.spotDepthFactor, 0, 100),
      perpDepthFactor: num(raw.risk?.perpDepthFactor, base.risk.perpDepthFactor, 0, 100),
      maxMarkIndexDeviationRate: num(raw.risk?.maxMarkIndexDeviationRate, base.risk.maxMarkIndexDeviationRate, 0, 1),
      minListedHours: int(raw.risk?.minListedHours, base.risk.minListedHours, 0, 10_000),
    },
    execution: {
      requireHumanApproval: true,
      allowRealOrders: bool(raw.execution?.allowRealOrders, base.execution.allowRealOrders),
      allowAutoOrderAfterTransfer: false,
      maxLegDeviationRate: num(raw.execution?.maxLegDeviationRate, base.execution.maxLegDeviationRate, 0, 1),
      orderTimeoutMs: int(raw.execution?.orderTimeoutMs, base.execution.orderTimeoutMs, 1_000, 600_000),
      freezeOnUnknownOrder: true,
      freezeOnUnknownTransfer: true,
      blockWhenOpenOrdersExist: bool(raw.execution?.blockWhenOpenOrdersExist, base.execution.blockWhenOpenOrdersExist),
      blockWhenSameSymbolPositionExists: bool(raw.execution?.blockWhenSameSymbolPositionExists, base.execution.blockWhenSameSymbolPositionExists),
    },
  };

  settings.notional.plannedNotionalUsdt = Math.min(settings.notional.plannedNotionalUsdt, settings.notional.maxOrderNotionalUsdt);
  settings.funding.blockFundingRate8h = Math.max(settings.funding.blockFundingRate8h, settings.funding.minFundingRate8h);
  settings.funding.blacklistFundingRate8h = Math.max(settings.funding.blacklistFundingRate8h, settings.funding.blockFundingRate8h);
  if (!settings.transfer.allowAutoTransfer && settings.transfer.mode === "auto_transfer") settings.transfer.mode = "suggest_only";
  if (settings.transfer.mode === "disabled") settings.transfer.allowAutoTransfer = false;
  return settings;
}

function mergePlain(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isRecord(value) && isRecord(out[key]) ? mergePlain(out[key], value) : value;
  }
  return out;
}

export function getUserStrategySettings(): UserStrategySettings {
  try {
    const latest = getRepository().latest("user_strategy_settings") as any;
    const raw = latest?.settings_json ?? latest?.settingsJson ?? latest?.settings;
    if (typeof raw === "string") return normalizeUserStrategySettings(JSON.parse(raw));
    if (isRecord(raw)) return normalizeUserStrategySettings(raw as DeepPartial<UserStrategySettings>);
  } catch {
    // fall through to defaults
  }
  return normalizeUserStrategySettings();
}

export function saveUserStrategySettings(patch: DeepPartial<UserStrategySettings>): UserStrategySettings {
  const merged = mergeSettings(getUserStrategySettings(), patch);
  getRepository().save("user_strategy_settings", {
    id: "current",
    updated_at_utc: Date.now(),
    settings_json: JSON.stringify(merged),
  });
  return merged;
}
