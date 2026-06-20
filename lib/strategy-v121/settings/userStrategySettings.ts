export type AutoTransferMode = "disabled" | "suggest_only" | "auto_transfer";

export interface UserStrategySettings {
  version: 1;
  funding: {
    minFundingRate8h: number;
    minNetProfitRate: number;
    minSecondsToFunding: number;
    maxSecondsToFunding?: number;
  };
  notional: {
    plannedNotionalUsdt: number;
    maxOrderNotionalUsdt: number;
    maxSymbolExposureUsdt: number;
    maxExchangeExposureUsdt: number;
    allowAutoDownsize: boolean;
  };
  capital: {
    globalReserveRate: number;
    minGlobalReserveUsdt: number;
    spotBufferRate: number;
    perpBufferRate: number;
  };
  transfer: {
    allowAutoTransfer: boolean;
    mode: AutoTransferMode;
    maxAutoTransferUsdt: number;
    allowSpotToPerp: boolean;
    allowPerpToSpot: boolean;
    requireReauditAfterTransfer: true;
  };
  universe: {
    useDynamicUniverse: boolean;
    maxDynamicSymbolsPerExchange: number;
    minSpotVolume24hUsdt: number;
    minPerpVolume24hUsdt: number;
    allowSmallCaps: boolean;
    symbolWhitelist: string[];
    symbolBlacklist: string[];
    prioritySymbols: string[];
  };
  execution: {
    requireHumanApproval: true;
    allowRealOrders: boolean;
    maxLegDeviationRate: number;
    orderTimeoutMs: number;
    freezeOnUnknownOrder: true;
    freezeOnUnknownTransfer: true;
  };
}

export const DEFAULT_USER_STRATEGY_SETTINGS: UserStrategySettings = {
  version: 1,
  funding: { minFundingRate8h: 0.0005, minNetProfitRate: 0, minSecondsToFunding: 300 },
  notional: { plannedNotionalUsdt: 10, maxOrderNotionalUsdt: 50, maxSymbolExposureUsdt: 50, maxExchangeExposureUsdt: 100, allowAutoDownsize: true },
  capital: { globalReserveRate: 0.2, minGlobalReserveUsdt: 10, spotBufferRate: 0.015, perpBufferRate: 0.035 },
  transfer: { allowAutoTransfer: false, mode: "disabled", maxAutoTransferUsdt: 50, allowSpotToPerp: true, allowPerpToSpot: true, requireReauditAfterTransfer: true },
  universe: { useDynamicUniverse: true, maxDynamicSymbolsPerExchange: 80, minSpotVolume24hUsdt: 1_000_000, minPerpVolume24hUsdt: 5_000_000, allowSmallCaps: false, symbolWhitelist: [], symbolBlacklist: [], prioritySymbols: ["BTC/USDT","ETH/USDT","SOL/USDT","XRP/USDT","DOGE/USDT","BNB/USDT","ADA/USDT","AVAX/USDT","LINK/USDT","SUI/USDT"] },
  execution: { requireHumanApproval: true, allowRealOrders: false, maxLegDeviationRate: 0.01, orderTimeoutMs: 15000, freezeOnUnknownOrder: true, freezeOnUnknownTransfer: true },
};

export function normalizeSettings(input: unknown): UserStrategySettings {
  if (!input || typeof input !== "object") return { ...DEFAULT_USER_STRATEGY_SETTINGS };
  const s = input as Record<string, any>;
  return {
    version: 1,
    funding: {
      minFundingRate8h: s.funding?.minFundingRate8h ?? DEFAULT_USER_STRATEGY_SETTINGS.funding.minFundingRate8h,
      minNetProfitRate: s.funding?.minNetProfitRate ?? DEFAULT_USER_STRATEGY_SETTINGS.funding.minNetProfitRate,
      minSecondsToFunding: s.funding?.minSecondsToFunding ?? DEFAULT_USER_STRATEGY_SETTINGS.funding.minSecondsToFunding,
    },
    notional: {
      plannedNotionalUsdt: s.notional?.plannedNotionalUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.notional.plannedNotionalUsdt,
      maxOrderNotionalUsdt: s.notional?.maxOrderNotionalUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.notional.maxOrderNotionalUsdt,
      maxSymbolExposureUsdt: s.notional?.maxSymbolExposureUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.notional.maxSymbolExposureUsdt,
      maxExchangeExposureUsdt: s.notional?.maxExchangeExposureUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.notional.maxExchangeExposureUsdt,
      allowAutoDownsize: s.notional?.allowAutoDownsize ?? DEFAULT_USER_STRATEGY_SETTINGS.notional.allowAutoDownsize,
    },
    capital: {
      globalReserveRate: s.capital?.globalReserveRate ?? DEFAULT_USER_STRATEGY_SETTINGS.capital.globalReserveRate,
      minGlobalReserveUsdt: s.capital?.minGlobalReserveUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.capital.minGlobalReserveUsdt,
      spotBufferRate: s.capital?.spotBufferRate ?? DEFAULT_USER_STRATEGY_SETTINGS.capital.spotBufferRate,
      perpBufferRate: s.capital?.perpBufferRate ?? DEFAULT_USER_STRATEGY_SETTINGS.capital.perpBufferRate,
    },
    transfer: {
      allowAutoTransfer: s.transfer?.allowAutoTransfer ?? DEFAULT_USER_STRATEGY_SETTINGS.transfer.allowAutoTransfer,
      mode: s.transfer?.mode ?? DEFAULT_USER_STRATEGY_SETTINGS.transfer.mode,
      maxAutoTransferUsdt: s.transfer?.maxAutoTransferUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.transfer.maxAutoTransferUsdt,
      allowSpotToPerp: s.transfer?.allowSpotToPerp ?? DEFAULT_USER_STRATEGY_SETTINGS.transfer.allowSpotToPerp,
      allowPerpToSpot: s.transfer?.allowPerpToSpot ?? DEFAULT_USER_STRATEGY_SETTINGS.transfer.allowPerpToSpot,
      requireReauditAfterTransfer: true,
    },
    universe: {
      useDynamicUniverse: s.universe?.useDynamicUniverse ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.useDynamicUniverse,
      maxDynamicSymbolsPerExchange: s.universe?.maxDynamicSymbolsPerExchange ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.maxDynamicSymbolsPerExchange,
      minSpotVolume24hUsdt: s.universe?.minSpotVolume24hUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.minSpotVolume24hUsdt,
      minPerpVolume24hUsdt: s.universe?.minPerpVolume24hUsdt ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.minPerpVolume24hUsdt,
      allowSmallCaps: s.universe?.allowSmallCaps ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.allowSmallCaps,
      symbolWhitelist: s.universe?.symbolWhitelist ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.symbolWhitelist,
      symbolBlacklist: s.universe?.symbolBlacklist ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.symbolBlacklist,
      prioritySymbols: s.universe?.prioritySymbols ?? DEFAULT_USER_STRATEGY_SETTINGS.universe.prioritySymbols,
    },
    execution: {
      requireHumanApproval: true,
      allowRealOrders: s.execution?.allowRealOrders ?? false,
      maxLegDeviationRate: s.execution?.maxLegDeviationRate ?? DEFAULT_USER_STRATEGY_SETTINGS.execution.maxLegDeviationRate,
      orderTimeoutMs: s.execution?.orderTimeoutMs ?? DEFAULT_USER_STRATEGY_SETTINGS.execution.orderTimeoutMs,
      freezeOnUnknownOrder: true,
      freezeOnUnknownTransfer: true,
    },
  };
}

export function validateSettings(s: UserStrategySettings): string[] {
  const errors: string[] = [];
  if (s.notional.plannedNotionalUsdt <= 0) errors.push("plannedNotionalUsdt 必须 > 0");
  if (s.notional.maxOrderNotionalUsdt < s.notional.plannedNotionalUsdt) errors.push("maxOrderNotionalUsdt 必须 >= plannedNotionalUsdt");
  if (s.capital.globalReserveRate < 0 || s.capital.globalReserveRate > 0.9) errors.push("globalReserveRate 必须在 0-0.9 之间");
  if (s.capital.spotBufferRate < 0 || s.capital.spotBufferRate > 0.2) errors.push("spotBufferRate 必须在 0-0.2 之间");
  if (s.capital.perpBufferRate < 0 || s.capital.perpBufferRate > 0.5) errors.push("perpBufferRate 必须在 0-0.5 之间");
  if (s.transfer.maxAutoTransferUsdt < 0) errors.push("maxAutoTransferUsdt 不能小于 0");
  if (s.universe.minSpotVolume24hUsdt < 0) errors.push("minSpotVolume24hUsdt 不能小于 0");
  if (s.universe.minPerpVolume24hUsdt < 0) errors.push("minPerpVolume24hUsdt 不能小于 0");
  if (s.universe.maxDynamicSymbolsPerExchange < 1 || s.universe.maxDynamicSymbolsPerExchange > 300) errors.push("maxDynamicSymbolsPerExchange 必须在 1-300 之间");
  if (!s.transfer.requireReauditAfterTransfer) errors.push("requireReauditAfterTransfer 必须为 true");
  if (!s.execution.requireHumanApproval) errors.push("requireHumanApproval 必须为 true");
  return errors;
}
