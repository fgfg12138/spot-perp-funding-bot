import { describe, expect, it, beforeEach } from "vitest";
import { runDiagnostics } from "./shadowDiagnostics";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("shadowDiagnostics", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_API_SECRET;
    delete process.env.OKX_PASSPHRASE;
    delete process.env.HTX_API_KEY;
    delete process.env.HTX_API_SECRET;
    resetRuntimeConfig();
  });

  it("无 API Key 时返回 env_not_configured", async () => {
    const results = await runDiagnostics();
    // All non-htx-open_orders should be env_not_configured
    const normal = results.filter(r => r.operation !== "open_orders" || r.exchange !== "htx");
    expect(normal.every(r => r.errorType === "env_not_configured")).toBe(true);
  });

  it("不泄露 secret 值", async () => {
    process.env.BINANCE_API_KEY = "my-test-key-12345";
    process.env.BINANCE_API_SECRET = "my-test-secret-67890";
    resetRuntimeConfig();
    const results = await runDiagnostics();
    const json = JSON.stringify(results);
    expect(json).not.toContain("my-test-key-12345");
    expect(json).not.toContain("my-test-secret-67890");
  });

  it("HTX open_orders 返回 not_implemented", async () => {
    const results = await runDiagnostics();
    const htxOrders = results.find(r => r.exchange === "htx" && r.operation === "open_orders");
    expect(htxOrders).toBeDefined();
    expect(htxOrders?.errorType).toBe("not_implemented");
    expect(htxOrders?.success).toBe(false);
  });

  it("共返回 9 条诊断记录", async () => {
    const results = await runDiagnostics();
    expect(results).toHaveLength(9);
  });
});
