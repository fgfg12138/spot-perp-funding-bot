import { describe, expect, it, beforeEach } from "vitest";
import { createRuntimeAdapter } from "./runtimeAdapterFactory";
import type { RuntimeApiKeyInput } from "./runtimeAdapterFactory";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("runtimeAdapterFactory", () => {
  beforeEach(() => {
    resetRuntimeConfig({});
  });

  describe("Binance", () => {
    it("status=ok 且 exchangeId=binance", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "test-key-1234567890",
        apiSecret: "test-secret",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("ok");
      expect(result.adapter.exchangeId).toBe("binance");
      expect(result.message).toBeUndefined();
    });

    it("apiKey 为空时 status=not_supported", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "",
        apiSecret: "test-secret",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("not_supported");
      expect(result.message).toContain("不完整");
    });

    it("apiSecret 为空时 status=not_supported", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "test-key",
        apiSecret: "",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("not_supported");
      expect(result.message).toContain("不完整");
    });

    it("healthCheck 不抛错（公共 ping 端点）", async () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "test-key-1234567890",
        apiSecret: "test-secret",
      };
      const result = createRuntimeAdapter(input);
      // healthCheck 访问公共端点，不应抛错（可能返回 false 但不抛）
      await expect(result.adapter.healthCheck()).resolves.not.toThrow();
    });

    it("fetchBalances 使用注入密钥签名（非 process.env）", async () => {
      // 确保 process.env 没有配置 BINANCE_API_KEY
      const originalKey = process.env.BINANCE_API_KEY;
      const originalSecret = process.env.BINANCE_API_SECRET;
      delete process.env.BINANCE_API_KEY;
      delete process.env.BINANCE_API_SECRET;

      try {
        const input: RuntimeApiKeyInput = {
          exchange: "binance",
          apiKey: "runtime-key-12345",
          apiSecret: "runtime-secret",
        };
        const result = createRuntimeAdapter(input);
        // 即使 process.env 没有配置，adapter 也能构造（不立即抛错）
        expect(result.status).toBe("ok");
        // fetchBalances 会尝试网络请求，预期失败（无真实 key），但不应因 env 缺失抛错
        try {
          await result.adapter.fetchBalances();
        } catch (e: any) {
          // 失败应该是网络/认证错误，不是 env 缺失错误
          expect(e.message).not.toContain("BINANCE_API_KEY");
          expect(e.message).not.toContain("环境变量");
        }
      } finally {
        if (originalKey !== undefined) process.env.BINANCE_API_KEY = originalKey;
        if (originalSecret !== undefined) process.env.BINANCE_API_SECRET = originalSecret;
      }
    });
  });

  describe("OKX", () => {
    it("status=ok，可执行只读探测", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "okx",
        apiKey: "okx-key",
        apiSecret: "okx-secret",
        passphrase: "okx-pass",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("ok");
      expect(result.message).toBeUndefined();
    });

    it("apiKey 为空时 status=not_supported", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "okx",
        apiKey: "",
        apiSecret: "okx-secret",
        passphrase: "okx-pass",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("not_supported");
      expect(result.message).toContain("不完整");
    });

    it("apiSecret 为空时 status=not_supported", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "okx",
        apiKey: "okx-key",
        apiSecret: "",
        passphrase: "okx-pass",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("not_supported");
      expect(result.message).toContain("不完整");
    });

    it("fetchBalances 使用注入密钥签名（非 process.env）", async () => {
      // 确保 process.env 没有配置 OKX_API_KEY
      const originalKey = process.env.OKX_API_KEY;
      const originalSecret = process.env.OKX_API_SECRET;
      const originalPass = process.env.OKX_PASSPHRASE;
      delete process.env.OKX_API_KEY;
      delete process.env.OKX_API_SECRET;
      delete process.env.OKX_PASSPHRASE;

      try {
        const input: RuntimeApiKeyInput = {
          exchange: "okx",
          apiKey: "runtime-okx-key",
          apiSecret: "runtime-okx-secret",
          passphrase: "runtime-okx-pass",
        };
        const result = createRuntimeAdapter(input);
        expect(result.status).toBe("ok");
        // fetchBalances 会尝试网络请求，预期失败（无真实 key），但不应因 env 缺失抛错
        try {
          await result.adapter.fetchBalances();
        } catch (e: any) {
          // 失败应该是网络/认证错误，不是 env 缺失错误
          expect(e.message).not.toContain("OKX_API_KEY");
          expect(e.message).not.toContain("环境变量");
        }
      } finally {
        if (originalKey !== undefined) process.env.OKX_API_KEY = originalKey;
        if (originalSecret !== undefined) process.env.OKX_API_SECRET = originalSecret;
        if (originalPass !== undefined) process.env.OKX_PASSPHRASE = originalPass;
      }
    });

    it("fetchPositions 使用注入密钥签名（非 process.env）", async () => {
      const input: RuntimeApiKeyInput = {
        exchange: "okx",
        apiKey: "runtime-okx-key",
        apiSecret: "runtime-okx-secret",
        passphrase: "runtime-okx-pass",
      };
      const result = createRuntimeAdapter(input);
      // fetchPositions 会尝试网络请求，预期失败（无真实 key），但不因 env 缺失抛错
      try {
        await result.adapter.fetchPositions();
      } catch (e: any) {
        expect(e.message).not.toContain("OKX_API_KEY");
        expect(e.message).not.toContain("环境变量");
      }
    });

    it("exchangeId 仍为 okx", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "okx",
        apiKey: "okx-key",
        apiSecret: "okx-secret",
        passphrase: "okx-pass",
      };
      const result = createRuntimeAdapter(input);
      expect(result.adapter.exchangeId).toBe("okx");
    });
  });

  describe("HTX", () => {
    it("status=observe_only", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "htx",
        apiKey: "htx-key",
        apiSecret: "htx-secret",
      };
      const result = createRuntimeAdapter(input);
      expect(result.status).toBe("observe_only");
      expect(result.message).toContain("observe-only");
    });

    it("fetchBalances 抛错（observe-only 不探测账户）", async () => {
      const input: RuntimeApiKeyInput = {
        exchange: "htx",
        apiKey: "htx-key",
        apiSecret: "htx-secret",
      };
      const result = createRuntimeAdapter(input);
      await expect(result.adapter.fetchBalances()).rejects.toThrow("observe-only");
    });

    it("exchangeId 为 htx", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "htx",
        apiKey: "htx-key",
        apiSecret: "htx-secret",
      };
      const result = createRuntimeAdapter(input);
      expect(result.adapter.exchangeId).toBe("htx");
    });
  });

  describe("安全检查", () => {
    it("adapter 不暴露明文密钥", () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "secret-api-key-value",
        apiSecret: "secret-api-secret-value",
      };
      const result = createRuntimeAdapter(input);
      // adapter 对象本身不应有可枚举的密钥字段
      const adapterJson = JSON.stringify(result.adapter);
      expect(adapterJson).not.toContain("secret-api-key-value");
      expect(adapterJson).not.toContain("secret-api-secret-value");
    });

    it("adapter 的下单方法调用时抛异常或返回 blocked", async () => {
      const input: RuntimeApiKeyInput = {
        exchange: "binance",
        apiKey: "test-key",
        apiSecret: "test-secret",
      };
      const result = createRuntimeAdapter(input);
      // 接口已改为必需方法，但运行时 read-only adapter 的下单/划转变体调用时会抛错
      await expect(async () => await (result.adapter as any).submitOrderLeg()).rejects.toThrow();
      await expect(async () => await (result.adapter as any).transferInternal()).rejects.toThrow();
      await expect(async () => await (result.adapter as any).fetchOrderByClientOrderId()).rejects.toThrow();
      // validateOrderPlan 不抛错，返回 ok=false
      const planResult = await (result.adapter as any).validateOrderPlan();
      expect(planResult.ok).toBe(false);
    });
  });
});
