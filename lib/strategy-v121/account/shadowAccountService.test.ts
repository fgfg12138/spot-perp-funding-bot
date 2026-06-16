import { describe, expect, it, beforeEach } from "vitest";
import { isApiKeyConfigured, getConfiguredExchanges, getShadowReport } from "./shadowAccountService";

describe("shadowAccountService", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_API_SECRET;
    delete process.env.OKX_PASSPHRASE;
    delete process.env.HTX_API_KEY;
    delete process.env.HTX_API_SECRET;
  });

  it("无 API Key 时返回未配置", () => {
    expect(isApiKeyConfigured("binance")).toBe(false);
  });

  it("有 API Key 时返回已配置", () => {
    process.env.BINANCE_API_KEY = "test-key";
    process.env.BINANCE_API_SECRET = "test-secret";
    expect(isApiKeyConfigured("binance")).toBe(true);
  });

  it("OKX 还需要 PASSPHRASE", () => {
    process.env.OKX_API_KEY = "k";
    process.env.OKX_API_SECRET = "s";
    expect(isApiKeyConfigured("okx")).toBe(false);
    process.env.OKX_PASSPHRASE = "p";
    expect(isApiKeyConfigured("okx")).toBe(true);
  });

  it("getConfiguredExchanges 不泄露 key 值", () => {
    process.env.BINANCE_API_KEY = "my-secret-key-abc";
    process.env.BINANCE_API_SECRET = "my-secret-value-xyz";
    const result = getConfiguredExchanges();
    const binance = result.find(r => r.exchange === "binance");
    expect(binance?.configured).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain("my-secret-key-abc");
    expect(json).not.toContain("my-secret-value-xyz");
  });

  it("getShadowReport 不包含 secret 值", async () => {
    // Set env vars to test that secret values are not leaked
    process.env.BINANCE_API_KEY = "my-secret-key-value";
    process.env.BINANCE_API_SECRET = "my-super-secret-123";
    const report = await getShadowReport();
    const json = JSON.stringify(report);
    // The report may reference env var NAMES in instructional text (e.g. "set BINANCE_API_KEY")
    // but must never leak actual VALUES
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
    expect(report.warnings.some(w => w.includes("未检测到"))).toBe(true);
    expect(report.warnings.some(w => w.includes("不会下单"))).toBe(true);
  });
});
