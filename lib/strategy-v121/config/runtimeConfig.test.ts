import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRuntimeConfig,
  getRuntimeConfig,
  resetRuntimeConfig,
  isRealOrderExecutionEnabled,
  isRealCloseExecutionEnabled,
  isRealInternalTransferEnabled,
  isMainnetTinyEnabled,
  isDevToolsEnabled,
  isShadowUseMock,
  getExchangeCredentials,
  isApiKeyConfigured,
  getMasterKey,
  getSqlitePath,
  getPersistenceModeFromConfig,
  getMaxDynamicSymbolsPerExchange,
} from "./runtimeConfig";

describe("runtimeConfig", () => {
  beforeEach(() => {
    resetRuntimeConfig({});
  });

  it("returns correct defaults for an empty environment", () => {
    const config = loadRuntimeConfig({});

    expect(config.mode).toBe("READ_ONLY");
    expect(config.persistenceMode).toBe("file");
    expect(config.sqlitePath).toBe(".v121-data/v121.sqlite");
    expect(config.featureFlags).toEqual({
      realOrderExecutionEnabled: false,
      realCloseExecutionEnabled: false,
      realInternalTransferEnabled: false,
    });
    expect(config.mainnetTiny).toEqual({
      enabled: false,
      riskConfirmed: false,
      dryRun: true,
    });
    expect(config.controlledLive).toEqual({
      enabled: false,
      riskConfirmed: false,
    });
    expect(config.capital).toEqual({
      globalReserveRate: 0.2,
      minGlobalReserveUsdt: 10,
      spotBufferRate: 0.015,
      perpBufferRate: 0.035,
      allowAutoTransfer: false,
      autoTransferMaxUsdt: 50,
    });
    expect(config.alert.telegram).toBeNull();
    expect(config.alert.email).toBeNull();
    expect(config.maxDynamicSymbolsPerExchange).toBe(50);
    expect(config.devToolsEnabled).toBe(false);
    expect(config.killSwitchFallback).toBe("OFF");
    expect(config.testFundingThreshold).toEqual({
      enabled: false,
      value8h: null,
    });
    expect(config.masterKey).toBeUndefined();
  });

  it("parses all supported environment variables correctly", () => {
    const env = {
      V121_MODE: "MAINNET_TINY",
      V121_PERSISTENCE_MODE: "sqlite-active",
      V121_SQLITE_PATH: "/tmp/test.sqlite",
      V121_ENABLE_REAL_ORDER_EXECUTION: "true",
      V121_ENABLE_REAL_CLOSE_EXECUTION: "true",
      V121_ENABLE_REAL_INTERNAL_TRANSFER: "true",
      V121_MAINNET_TINY_ENABLED: "true",
      V121_CONFIRM_MAINNET_TINY_RISK: "I_UNDERSTAND",
      V121_MAINNET_TINY_DRY_RUN: "false",
      V121_LIVE_ENABLED: "true",
      V121_CONFIRM_LIVE_RISK: "I_UNDERSTAND",
      V121_GLOBAL_RESERVE_RATE: "0.25",
      V121_MIN_GLOBAL_RESERVE_USDT: "200",
      V121_SPOT_BUFFER_RATE: "0.1",
      V121_PERP_BUFFER_RATE: "0.08",
      V121_ALLOW_AUTO_TRANSFER: "true",
      V121_AUTO_TRANSFER_MAX_USDT: "1000",
      V121_ALERT_TELEGRAM_BOT_TOKEN: "token",
      V121_ALERT_TELEGRAM_CHAT_ID: "chat123",
      V121_ALERT_EMAIL_SMTP_HOST: "smtp.example.com",
      V121_ALERT_EMAIL_SMTP_PORT: "465",
      V121_ALERT_EMAIL_USER: "user@example.com",
      V121_ALERT_EMAIL_PASS: "secret",
      V121_ALERT_EMAIL_TO: "to@example.com",
      V121_ALERT_EMAIL_FROM: "from@example.com",
      V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE: "100",
      V121_ENABLE_DEV_TOOLS: "true",
      V121_KILL_SWITCH: "PAUSE_NEW_ENTRIES",
      V121_TEST_FUNDING_THRESHOLD_ENABLED: "true",
      V121_TEST_FUNDING_THRESHOLD_8H: "0.005",
      V121_MASTER_KEY: "master-secret",
    };

    const config = loadRuntimeConfig(env);

    expect(config.mode).toBe("MAINNET_TINY");
    expect(config.persistenceMode).toBe("sqlite-active");
    expect(config.sqlitePath).toBe("/tmp/test.sqlite");
    expect(config.featureFlags.realOrderExecutionEnabled).toBe(true);
    expect(config.featureFlags.realCloseExecutionEnabled).toBe(true);
    expect(config.featureFlags.realInternalTransferEnabled).toBe(true);
    expect(config.mainnetTiny).toEqual({
      enabled: true,
      riskConfirmed: true,
      riskConfirmedRaw: "I_UNDERSTAND",
      dryRun: false,
    });
    expect(config.controlledLive).toEqual({
      enabled: true,
      riskConfirmed: true,
    });
    expect(config.capital).toEqual({
      globalReserveRate: 0.25,
      minGlobalReserveUsdt: 200,
      spotBufferRate: 0.1,
      perpBufferRate: 0.08,
      allowAutoTransfer: true,
      autoTransferMaxUsdt: 1000,
    });
    expect(config.alert.telegram).toEqual({
      botToken: "token",
      chatId: "chat123",
    });
    expect(config.alert.email).toEqual({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      user: "user@example.com",
      pass: "secret",
      to: "to@example.com",
      from: "from@example.com",
    });
    expect(config.maxDynamicSymbolsPerExchange).toBe(100);
    expect(config.devToolsEnabled).toBe(true);
    expect(config.killSwitchFallback).toBe("PAUSE_NEW_ENTRIES");
    expect(config.testFundingThreshold).toEqual({
      enabled: true,
      value8h: 0.005,
    });
    expect(config.masterKey).toBe("master-secret");
  });

  it("treats V121_ENABLE_REAL_ORDER_EXECUTION as enabled", () => {
    const config = loadRuntimeConfig({
      V121_ENABLE_REAL_ORDER_EXECUTION: "true",
    });
    expect(config.featureFlags.realOrderExecutionEnabled).toBe(true);
  });

  it("treats V121_REAL_ORDER_EXECUTION_ENABLED as enabled", () => {
    const config = loadRuntimeConfig({
      V121_REAL_ORDER_EXECUTION_ENABLED: "true",
    });
    expect(config.featureFlags.realOrderExecutionEnabled).toBe(true);
  });

  it("resetRuntimeConfig reloads the cached singleton", () => {
    const first = getRuntimeConfig();
    expect(first.featureFlags.realOrderExecutionEnabled).toBe(false);

    const second = resetRuntimeConfig({
      V121_ENABLE_REAL_ORDER_EXECUTION: "true",
    });
    expect(second.featureFlags.realOrderExecutionEnabled).toBe(true);
    expect(getRuntimeConfig()).toBe(second);
    expect(isRealOrderExecutionEnabled()).toBe(true);
  });

  it("falls back to numeric defaults for invalid numeric values", () => {
    const config = loadRuntimeConfig({
      V121_GLOBAL_RESERVE_RATE: "not-a-number",
      V121_MIN_GLOBAL_RESERVE_USDT: "",
      V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE: "abc",
      V121_TEST_FUNDING_THRESHOLD_8H: "invalid",
    });

    expect(config.capital.globalReserveRate).toBe(0.2);
    expect(config.capital.minGlobalReserveUsdt).toBe(10);
    expect(config.maxDynamicSymbolsPerExchange).toBe(50);
    expect(config.testFundingThreshold.value8h).toBeNull();
  });

  it("parses boolean values for true, 1, and yes (and rejects others)", () => {
    const config = loadRuntimeConfig({
      V121_ENABLE_REAL_CLOSE_EXECUTION: "true",
      V121_ENABLE_REAL_INTERNAL_TRANSFER: "1",
      V121_ENABLE_DEV_TOOLS: "yes",
      V121_ENABLE_REAL_ORDER_EXECUTION: "false",
      V121_MAINNET_TINY_ENABLED: "0",
      V121_ALLOW_AUTO_TRANSFER: "nope",
    });

    expect(config.featureFlags.realCloseExecutionEnabled).toBe(true);
    expect(config.featureFlags.realInternalTransferEnabled).toBe(true);
    expect(config.devToolsEnabled).toBe(true);
    expect(config.featureFlags.realOrderExecutionEnabled).toBe(false);
    expect(config.mainnetTiny.enabled).toBe(false);
    expect(config.capital.allowAutoTransfer).toBe(false);
  });

  it("exposes convenience getters over the singleton", () => {
    resetRuntimeConfig({
      V121_ENABLE_REAL_ORDER_EXECUTION: "true",
      V121_ENABLE_REAL_CLOSE_EXECUTION: "1",
      V121_ENABLE_REAL_INTERNAL_TRANSFER: "yes",
      V121_MAINNET_TINY_ENABLED: "true",
      V121_ENABLE_DEV_TOOLS: "true",
    });

    expect(isRealOrderExecutionEnabled()).toBe(true);
    expect(isRealCloseExecutionEnabled()).toBe(true);
    expect(isRealInternalTransferEnabled()).toBe(true);
    expect(isMainnetTinyEnabled()).toBe(true);
    expect(isDevToolsEnabled()).toBe(true);
  });

  it("getRuntimeConfig returns singleton — multiple calls return the same object", () => {
    resetRuntimeConfig({});
    const first = getRuntimeConfig();
    const second = getRuntimeConfig();
    expect(first).toBe(second);
  });

  it("loadRuntimeConfig creates a new object each call", () => {
    const first = loadRuntimeConfig({});
    const second = loadRuntimeConfig({});
    expect(first).not.toBe(second);
    expect(first.mode).toBe(second.mode);
  });

  it("resetRuntimeConfig replaces the cached singleton", () => {
    resetRuntimeConfig({ V121_MODE: "READ_ONLY" });
    const before = getRuntimeConfig();
    expect(before.mode).toBe("READ_ONLY");

    resetRuntimeConfig({ V121_MODE: "PAPER" });
    const after = getRuntimeConfig();
    expect(after.mode).toBe("PAPER");
    expect(after).not.toBe(before);
  });

  it("convenience getters reflect resetRuntimeConfig changes", () => {
    resetRuntimeConfig({ V121_ENABLE_REAL_ORDER_EXECUTION: "true" });
    expect(isRealOrderExecutionEnabled()).toBe(true);

    resetRuntimeConfig({ V121_ENABLE_REAL_ORDER_EXECUTION: "false" });
    expect(isRealOrderExecutionEnabled()).toBe(false);
  });

  it("isShadowUseMock returns correct default", () => {
    resetRuntimeConfig({});
    expect(isShadowUseMock()).toBe(false);
  });

  it("getExchangeCredentials returns null for unconfigured exchanges", () => {
    resetRuntimeConfig({});
    expect(getExchangeCredentials("binance")).toBeNull();
    expect(getExchangeCredentials("okx")).toBeNull();
    expect(getExchangeCredentials("htx")).toBeNull();
  });

  it("isApiKeyConfigured returns false when no keys set", () => {
    resetRuntimeConfig({});
    expect(isApiKeyConfigured("binance")).toBe(false);
  });

  it("getMasterKey returns undefined when not set", () => {
    resetRuntimeConfig({});
    expect(getMasterKey()).toBeUndefined();
  });

  it("getSqlitePath returns default path", () => {
    resetRuntimeConfig({});
    expect(getSqlitePath()).toBe(".v121-data/v121.sqlite");
  });

  it("getPersistenceModeFromConfig returns default mode", () => {
    resetRuntimeConfig({});
    expect(getPersistenceModeFromConfig()).toBe("file");
  });

  it("getMaxDynamicSymbolsPerExchange returns default value", () => {
    resetRuntimeConfig({});
    expect(getMaxDynamicSymbolsPerExchange()).toBe(50);
  });

  it("getExchangeCredentials returns credentials when configured", () => {
    resetRuntimeConfig({
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET: "test-secret",
    });
    const creds = getExchangeCredentials("binance");
    expect(creds).not.toBeNull();
    expect(creds!.apiKey).toBe("test-key");
    expect(creds!.apiSecret).toBe("test-secret");
  });

  it("isApiKeyConfigured returns true when keys are configured", () => {
    resetRuntimeConfig({
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET: "test-secret",
    });
    expect(isApiKeyConfigured("binance")).toBe(true);
  });
});
