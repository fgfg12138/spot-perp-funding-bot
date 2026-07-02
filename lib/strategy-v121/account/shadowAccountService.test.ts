import { describe, expect, it, beforeEach } from "vitest";
import { isApiKeyConfigured, getConfiguredExchanges, getShadowReport } from "./shadowAccountService";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("shadowAccountService", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_API_SECRET;
    delete process.env.OKX_PASSPHRASE;
    delete process.env.HTX_API_KEY;
    delete process.env.HTX_API_SECRET;
    delete process.env.V121_SHADOW_USE_MOCK;
    resetRuntimeConfig();
  });

  it("无 API Key 时返回未配置", () => {
    expect(isApiKeyConfigured("binance")).toBe(false);
  });

  it("有 API Key 时返回已配置", () => {
    process.env.BINANCE_API_KEY = "test-key";
    process.env.BINANCE_API_SECRET = "test-secret";
    resetRuntimeConfig();
    expect(isApiKeyConfigured("binance")).toBe(true);
  });

  it("OKX 还需要 PASSPHRASE", () => {
    process.env.OKX_API_KEY = "k";
    process.env.OKX_API_SECRET = "s";
    resetRuntimeConfig();
    expect(isApiKeyConfigured("okx")).toBe(false);
    process.env.OKX_PASSPHRASE = "p";
    resetRuntimeConfig();
    expect(isApiKeyConfigured("okx")).toBe(true);
  });

  it("getConfiguredExchanges 不泄露 key 值", () => {
    process.env.BINANCE_API_KEY = "my-secret-key-abc";
    process.env.BINANCE_API_SECRET = "my-secret-value-xyz";
    resetRuntimeConfig();
    const result = getConfiguredExchanges();
    const binance = result.find(r => r.exchange === "binance");
    expect(binance?.configured).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain("my-secret-key-abc");
    expect(json).not.toContain("my-secret-value-xyz");
  });

  it("getShadowReport 不包含 secret 值", async () => {
    process.env.V121_SHADOW_USE_MOCK = "1";  // use mock so no real API call
    process.env.BINANCE_API_KEY = "my-secret-key-value";
    process.env.BINANCE_API_SECRET = "my-super-secret-123";
    resetRuntimeConfig();
    const report = await getShadowReport();
    const json = JSON.stringify(report);
    expect(json).not.toContain("my-secret-key-value");
    expect(json).not.toContain("my-super-secret-123");
  });

  it("getShadowReport 返回只读模式标识", async () => {
    const report = await getShadowReport();
    expect(report.mode).toBe("SHADOW");
    expect(report.canModifyAccount).toBe(false);
  });

  it("缺 API Key 时返回中文提示", async () => {
    const report = await getShadowReport();
    expect(report.warnings.some(w => w.includes("未检测到") || w.includes("未配置"))).toBe(true);
  });
});
