import { describe, expect, it, beforeEach } from "vitest";
import { createAccountAdapter, dataSourceLabel } from "./accountAdapterFactory";

describe("accountAdapterFactory", () => {
  beforeEach(() => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BINANCE_API_SECRET;
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_API_SECRET;
    delete process.env.OKX_PASSPHRASE;
    delete process.env.HTX_API_KEY;
    delete process.env.HTX_API_SECRET;
    delete process.env.V121_SHADOW_USE_MOCK;
  });

  it("无 API Key 且无 mock 标志 → not_configured", () => {
    const { dataSource } = createAccountAdapter("binance");
    expect(dataSource).toBe("not_configured");
  });

  it("V121_SHADOW_USE_MOCK=1 → mock", () => {
    process.env.V121_SHADOW_USE_MOCK = "1";
    const { dataSource } = createAccountAdapter("binance");
    expect(dataSource).toBe("mock");
  });

  it("有 API Key 时返回 real", () => {
    process.env.BINANCE_API_KEY = "test-key";
    process.env.BINANCE_API_SECRET = "test-secret";
    const { dataSource } = createAccountAdapter("binance");
    expect(dataSource).toBe("real");
  });

  it("OKX 还需 PASSPHRASE", () => {
    process.env.OKX_API_KEY = "k";
    process.env.OKX_API_SECRET = "s";
    expect(createAccountAdapter("okx").dataSource).toBe("not_configured");
    process.env.OKX_PASSPHRASE = "p";
    expect(createAccountAdapter("okx").dataSource).toBe("real");
  });

  it("工厂返回的对象不包含 secret 值", () => {
    process.env.BINANCE_API_KEY = "my-key-abc";
    process.env.BINANCE_API_SECRET = "my-secret-xyz";
    const { dataSource } = createAccountAdapter("binance");
    expect(dataSource).toBe("real");
    // 不把 secret 编码到输出中
    const json = JSON.stringify(createAccountAdapter("binance").adapter);
    expect(json).not.toContain("my-key-abc");
    expect(json).not.toContain("my-secret-xyz");
  });
});

describe("dataSourceLabel", () => {
  it("返回中文标签", () => {
    expect(dataSourceLabel("real")).toBe("真实账户");
    expect(dataSourceLabel("mock")).toBe("开发模拟");
    expect(dataSourceLabel("not_configured")).toBe("未配置");
  });
});
