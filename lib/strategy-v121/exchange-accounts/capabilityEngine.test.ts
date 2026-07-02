import { describe, expect, it } from "vitest";
import { decideArbCapability, applyArbDecision, filterArbCapableAccounts } from "./capabilityEngine";
import type { ExchangeCapability } from "./types";

// ─── Fixtures ──────────────────────────────────────

function makeFullCapability(overrides: Partial<ExchangeCapability> = {}): ExchangeCapability {
  return {
    accountId: "acc_001",
    exchange: "binance",
    readBalance: true,
    readSpot: true,
    readPerp: true,
    tradeSpot: true,
    tradePerp: true,
    internalTransfer: false,
    fundingRate: true,
    positions: true,
    orders: true,
    sameExchangeArbEnabled: false,
    crossExchangeArbEnabled: false,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────

describe("capabilityEngine", () => {
  describe("decideArbCapability", () => {
    it("全部权限满足时，同交易所套利 enabled", () => {
      const cap = makeFullCapability();
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(true);
      expect(decision.crossExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toHaveLength(1); // 跨交易所禁用的 reason
    });

    it("缺少 tradeSpot 时禁用", () => {
      const cap = makeFullCapability({ tradeSpot: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toContain("缺少 tradeSpot 权限");
    });

    it("缺少 tradePerp 时禁用", () => {
      const cap = makeFullCapability({ tradePerp: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toContain("缺少 tradePerp 权限");
    });

    it("缺少 positions 时禁用", () => {
      const cap = makeFullCapability({ positions: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toContain("缺少 positions 读取权限");
    });

    it("缺少 fundingRate 时禁用", () => {
      const cap = makeFullCapability({ fundingRate: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toContain("缺少 fundingRate 读取权限");
    });

    it("缺少 readBalance 时禁用（风控必需）", () => {
      const cap = makeFullCapability({ readBalance: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons).toContain("缺少 readBalance 权限（风控必需）");
    });

    it("HTX 账户始终 observe-only", () => {
      const cap = makeFullCapability({ exchange: "htx" });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons.some(r => r.includes("HTX"))).toBe(true);
    });

    it("跨交易所套利默认禁用", () => {
      const cap = makeFullCapability({ internalTransfer: true });
      const decision = decideArbCapability(cap);
      expect(decision.crossExchangeArbEnabled).toBe(false);
      expect(decision.reasons.some(r => r.includes("跨交易所套利"))).toBe(true);
    });

    it("lastError 会生成 warning", () => {
      const cap = makeFullCapability({ lastError: "timeout" });
      const decision = decideArbCapability(cap);
      expect(decision.warnings.some(w => w.includes("timeout"))).toBe(true);
    });

    it("同交易所可用但 orders 缺失时生成 warning", () => {
      const cap = makeFullCapability({ orders: false });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(true);
      expect(decision.warnings.some(w => w.includes("orders 读取权限"))).toBe(true);
    });

    it("全部权限缺失时，reasons 包含所有缺失项", () => {
      const cap = makeFullCapability({
        tradeSpot: false,
        tradePerp: false,
        positions: false,
        fundingRate: false,
        readBalance: false,
      });
      const decision = decideArbCapability(cap);
      expect(decision.sameExchangeArbEnabled).toBe(false);
      expect(decision.reasons.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("applyArbDecision", () => {
    it("返回带 decision 的 capability 副本", () => {
      const cap = makeFullCapability();
      const result = applyArbDecision(cap);
      expect(result.sameExchangeArbEnabled).toBe(true);
      expect(result.crossExchangeArbEnabled).toBe(false);
      expect(result.decision).toBeDefined();
      expect(result.decision.sameExchangeArbEnabled).toBe(true);
    });

    it("不修改原始对象", () => {
      const cap = makeFullCapability();
      const original = { ...cap };
      applyArbDecision(cap);
      expect(cap.sameExchangeArbEnabled).toBe(original.sameExchangeArbEnabled);
    });
  });

  describe("filterArbCapableAccounts", () => {
    it("仅返回同交易所套利可用的账户", () => {
      const caps = [
        makeFullCapability({ accountId: "a1", exchange: "binance" }),
        makeFullCapability({ accountId: "a2", exchange: "binance", tradeSpot: false }),
        makeFullCapability({ accountId: "a3", exchange: "okx" }),
        makeFullCapability({ accountId: "a4", exchange: "htx" }),
      ];
      const capable = filterArbCapableAccounts(caps);
      expect(capable).toHaveLength(2);
      expect(capable.map(c => c.accountId).sort()).toEqual(["a1", "a3"]);
    });

    it("空数组返回空数组", () => {
      expect(filterArbCapableAccounts([])).toHaveLength(0);
    });
  });
});
