/**
 * RuntimeConfig — 策略运行时所有环境变量的统一读取入口。
 *
 * 设计原则：
 * 1. 所有 process.env 读取在模块初始化时完成一次，后续使用快照。
 * 2. 提供强类型 getter，返回类型明确。
 * 3. 支持测试通过 resetRuntimeConfig() 重新加载。
 * 4. 不引入外部依赖（如 zod），避免增加包体积；使用 TypeScript 类型 + 运行时校验函数。
 */

import type { ExchangeId, StrategyMode } from "../domain/types";
import type { KillSwitchState } from "../risk/killSwitch";

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface RuntimeConfig {
  /** Parsed strategy mode (always a valid StrategyMode). */
  mode: StrategyMode;
  /** Raw V121_MODE value before parsing (undefined if absent). */
  rawMode: string | undefined;
  persistenceMode: string;
  sqlitePath: string;

  featureFlags: {
    realOrderExecutionEnabled: boolean;
    realCloseExecutionEnabled: boolean;
    realInternalTransferEnabled: boolean;
  };

  mainnetTiny: {
    enabled: boolean;
    /** boolean form of V121_CONFIRM_MAINNET_TINY_RISK */
    riskConfirmed: boolean;
    /** raw string value of V121_CONFIRM_MAINNET_TINY_RISK (for "I_UNDERSTAND" exact match) */
    riskConfirmedRaw: string | undefined;
    dryRun: boolean;
  };

  controlledLive: {
    enabled: boolean;
    riskConfirmed: boolean;
  };

  capital: {
    globalReserveRate: number;
    minGlobalReserveUsdt: number;
    spotBufferRate: number;
    perpBufferRate: number;
    allowAutoTransfer: boolean;
    autoTransferMaxUsdt: number;
  };

  alert: {
    telegram: { botToken: string; chatId: string } | null;
    email: {
      smtpHost: string;
      smtpPort: number;
      user: string;
      pass: string;
      to: string;
      from: string;
    } | null;
  };

  exchangeCredentials: Record<ExchangeId, ExchangeCredentials | null>;
  shadowUseMock: boolean;

  maxDynamicSymbolsPerExchange: number;
  devToolsEnabled: boolean;
  killSwitchFallback: KillSwitchState;
  /** Raw V121_KILL_SWITCH value before parsing, for string-level checks. */
  rawKillSwitch: string | undefined;
  testFundingThreshold: {
    enabled: boolean;
    value8h: number | null;
  };
  masterKey: string | undefined;
}

const STRATEGY_MODES: readonly StrategyMode[] = [
  "READ_ONLY",
  "PAPER",
  "SHADOW",
  "MAINNET_TINY",
  "CONTROLLED_LIVE",
];

const KILL_SWITCH_STATES: readonly KillSwitchState[] = [
  "OFF",
  "READ_ONLY_ONLY",
  "PAUSE_NEW_ENTRIES",
  "PAUSE_ALL_AUTOMATION",
];

const DEFAULTS: RuntimeConfig = {
  mode: "READ_ONLY",
  rawMode: undefined,
  persistenceMode: "file",
  sqlitePath: ".v121-data/v121.sqlite",
  featureFlags: {
    realOrderExecutionEnabled: false,
    realCloseExecutionEnabled: false,
    realInternalTransferEnabled: false,
  },
  mainnetTiny: {
    enabled: false,
    riskConfirmed: false,
    riskConfirmedRaw: undefined,
    dryRun: true,
  },
  controlledLive: {
    enabled: false,
    riskConfirmed: false,
  },
  capital: {
    globalReserveRate: 0.2,
    minGlobalReserveUsdt: 10,
    spotBufferRate: 0.015,
    perpBufferRate: 0.035,
    allowAutoTransfer: false,
    autoTransferMaxUsdt: 50,
  },
  alert: {
    telegram: null,
    email: null,
  },
  exchangeCredentials: {
    binance: null,
    okx: null,
    htx: null,
  },
  shadowUseMock: false,
  maxDynamicSymbolsPerExchange: 50,
  devToolsEnabled: false,
  killSwitchFallback: "OFF",
  rawKillSwitch: undefined,
  testFundingThreshold: {
    enabled: false,
    value8h: null,
  },
  masterKey: undefined,
};

let _config: RuntimeConfig | null = null;

export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const modeStr = env.V121_MODE;
  const mode = parseMode(modeStr);
  const persistenceMode = env.V121_PERSISTENCE_MODE ?? DEFAULTS.persistenceMode;
  const sqlitePath = env.V121_SQLITE_PATH ?? DEFAULTS.sqlitePath;

  const realOrderExecutionEnabled =
    parseBool(env.V121_ENABLE_REAL_ORDER_EXECUTION, false) ||
    parseBool(env.V121_REAL_ORDER_EXECUTION_ENABLED, false);

  const rawKillSwitchVal = env.V121_KILL_SWITCH;

  return {
    mode,
    rawMode: modeStr,
    persistenceMode,
    sqlitePath,
    featureFlags: {
      realOrderExecutionEnabled,
      realCloseExecutionEnabled: parseBool(
        env.V121_ENABLE_REAL_CLOSE_EXECUTION,
        DEFAULTS.featureFlags.realCloseExecutionEnabled,
      ),
      realInternalTransferEnabled: parseBool(
        env.V121_ENABLE_REAL_INTERNAL_TRANSFER,
        DEFAULTS.featureFlags.realInternalTransferEnabled,
      ),
    },
    mainnetTiny: {
      enabled: parseBool(
        env.V121_MAINNET_TINY_ENABLED,
        DEFAULTS.mainnetTiny.enabled,
      ),
      riskConfirmed: parseRiskConfirmation(
        env.V121_CONFIRM_MAINNET_TINY_RISK,
        DEFAULTS.mainnetTiny.riskConfirmed,
      ),
      riskConfirmedRaw: env.V121_CONFIRM_MAINNET_TINY_RISK,
      dryRun: parseBool(
        env.V121_MAINNET_TINY_DRY_RUN,
        DEFAULTS.mainnetTiny.dryRun,
      ),
    },
    controlledLive: {
      enabled: parseBool(
        env.V121_LIVE_ENABLED,
        DEFAULTS.controlledLive.enabled,
      ),
      riskConfirmed: parseRiskConfirmation(
        env.V121_CONFIRM_LIVE_RISK,
        DEFAULTS.controlledLive.riskConfirmed,
      ),
    },
    capital: {
      globalReserveRate: parseNumber(
        env.V121_GLOBAL_RESERVE_RATE,
        DEFAULTS.capital.globalReserveRate,
      ),
      minGlobalReserveUsdt: parseNumber(
        env.V121_MIN_GLOBAL_RESERVE_USDT,
        DEFAULTS.capital.minGlobalReserveUsdt,
      ),
      spotBufferRate: parseNumber(
        env.V121_SPOT_BUFFER_RATE,
        DEFAULTS.capital.spotBufferRate,
      ),
      perpBufferRate: parseNumber(
        env.V121_PERP_BUFFER_RATE,
        DEFAULTS.capital.perpBufferRate,
      ),
      allowAutoTransfer: parseBool(
        env.V121_ALLOW_AUTO_TRANSFER,
        DEFAULTS.capital.allowAutoTransfer,
      ),
      autoTransferMaxUsdt: parseNumber(
        env.V121_AUTO_TRANSFER_MAX_USDT,
        DEFAULTS.capital.autoTransferMaxUsdt,
      ),
    },
    alert: {
      telegram: parseTelegramConfig(env),
      email: parseEmailConfig(env),
    },
    exchangeCredentials: {
      binance: parseExchangeCredentials(env, "binance"),
      okx: parseExchangeCredentials(env, "okx"),
      htx: parseExchangeCredentials(env, "htx"),
    },
    shadowUseMock: parseBool(
      env.V121_SHADOW_USE_MOCK,
      DEFAULTS.shadowUseMock,
    ),
    maxDynamicSymbolsPerExchange: parseIntWithDefault(
      env.V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE,
      DEFAULTS.maxDynamicSymbolsPerExchange,
    ),
    devToolsEnabled: parseBool(
      env.V121_ENABLE_DEV_TOOLS,
      DEFAULTS.devToolsEnabled,
    ),
    killSwitchFallback: parseKillSwitch(
      rawKillSwitchVal,
      DEFAULTS.killSwitchFallback,
    ),
    rawKillSwitch: rawKillSwitchVal,
    testFundingThreshold: {
      enabled: parseBool(
        env.V121_TEST_FUNDING_THRESHOLD_ENABLED,
        DEFAULTS.testFundingThreshold.enabled,
      ),
      value8h: parseOptionalNumber(env.V121_TEST_FUNDING_THRESHOLD_8H),
    },
    masterKey: env.V121_MASTER_KEY,
  };
}

function parseMode(value: string | undefined): StrategyMode {
  if (value === undefined) return DEFAULTS.mode;
  const normalized = value.trim();
  if (STRATEGY_MODES.includes(normalized as StrategyMode)) {
    return normalized as StrategyMode;
  }
  return DEFAULTS.mode;
}

function parseKillSwitch(
  value: string | undefined,
  defaultValue: KillSwitchState,
): KillSwitchState {
  if (value === undefined) return defaultValue;
  const normalized = value.trim();
  if (KILL_SWITCH_STATES.includes(normalized as KillSwitchState)) {
    return normalized as KillSwitchState;
  }
  return defaultValue;
}

function parseTelegramConfig(
  env: Record<string, string | undefined>,
): { botToken: string; chatId: string } | null {
  const botToken = env.V121_ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = env.V121_ALERT_TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

function parseEmailConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig["alert"]["email"] {
  const smtpHost = env.V121_ALERT_EMAIL_SMTP_HOST;
  const portValue = env.V121_ALERT_EMAIL_SMTP_PORT;
  const user = env.V121_ALERT_EMAIL_USER;
  const pass = env.V121_ALERT_EMAIL_PASS;
  const to = env.V121_ALERT_EMAIL_TO;
  const from = env.V121_ALERT_EMAIL_FROM;
  if (!smtpHost || !portValue || !user || !pass || !to || !from) {
    return null;
  }
  const smtpPort = parseIntWithDefault(portValue, 587);
  return { smtpHost, smtpPort, user, pass, to, from };
}

function parseExchangeCredentials(
  env: Record<string, string | undefined>,
  exchange: ExchangeId,
): ExchangeCredentials | null {
  const prefix = exchange.toUpperCase();
  const apiKey = env[`${prefix}_API_KEY`];
  const apiSecret = env[`${prefix}_API_SECRET`];
  if (!apiKey || !apiSecret) return null;
  const passphrase = env[`${prefix}_PASSPHRASE`];
  if (exchange === "okx") {
    if (!passphrase) return null;
    return { apiKey, apiSecret, passphrase };
  }
  return { apiKey, apiSecret };
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseRiskConfirmation(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "i_understand";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const trimmed = value.trim();
  if (trimmed === "") return defaultValue;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : defaultValue;
}

function parseIntWithDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (!_config) {
    _config = loadRuntimeConfig();
  }
  return _config;
}

export function resetRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  _config = loadRuntimeConfig(env);
  return _config;
}

export function isRealOrderExecutionEnabled(): boolean {
  return getRuntimeConfig().featureFlags.realOrderExecutionEnabled;
}

export function isRealCloseExecutionEnabled(): boolean {
  return getRuntimeConfig().featureFlags.realCloseExecutionEnabled;
}

export function isRealInternalTransferEnabled(): boolean {
  return getRuntimeConfig().featureFlags.realInternalTransferEnabled;
}

export function isMainnetTinyEnabled(): boolean {
  return getRuntimeConfig().mainnetTiny.enabled;
}

export function isDevToolsEnabled(): boolean {
  return getRuntimeConfig().devToolsEnabled;
}

export function isShadowUseMock(): boolean {
  return getRuntimeConfig().shadowUseMock;
}

export function getExchangeCredentials(exchange: ExchangeId): ExchangeCredentials | null {
  return getRuntimeConfig().exchangeCredentials[exchange];
}

export function isApiKeyConfigured(exchange: ExchangeId): boolean {
  return getExchangeCredentials(exchange) !== null;
}

export function getMasterKey(): string | undefined {
  return getRuntimeConfig().masterKey;
}

export function getSqlitePath(): string {
  return getRuntimeConfig().sqlitePath;
}

export function getPersistenceModeFromConfig(): string {
  return getRuntimeConfig().persistenceMode;
}

export function getMaxDynamicSymbolsPerExchange(): number {
  return getRuntimeConfig().maxDynamicSymbolsPerExchange;
}
