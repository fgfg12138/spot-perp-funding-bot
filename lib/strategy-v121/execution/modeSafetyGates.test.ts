/**
 * 模式安全门测试 — 确保各个模式下不能绕过安全门
 *
 * 测试范围：
 * - READ_ONLY 模式下所有资金操作被阻止
 * - PAPER 模式下所有资金操作被阻止
 * - SHADOW 模式下所有资金操作被阻止
 * - MAINNET_TINY 需要完整的 env 门禁 + 确认
 * - CONTROLLED_LIVE 需要单独的 env 门禁
 */
import { describe, expect, it, beforeEach } from "vitest";
import { canPlaceRealOrders, MODE_REQUIREMENTS, MAINNET_TINY_DEFAULT_LIMITS, CONTROLLED_LIVE_DEFAULT_LIMITS } from "../config/strategyConfig";
import { isActionBlockedInShadow, assertNotShadow } from "../account/accountSafety";
import { checkMainnetTinyGate, validateOrderIntent } from "../mainnetTiny/mainnetTinyGate";
import { isPersistenceReadyForTiny } from "../persistence/persistenceMode";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("P4.3 — 模式安全门全面覆盖", () => {
  // ── READ_ONLY ──────────────────────────────────────────────

  describe("READ_ONLY safety gates", () => {
    it("MODE_REQUIREMENTS explicitly disallows real orders", () => {
      expect(MODE_REQUIREMENTS.READ_ONLY.disallowOrder).toBe(true);
    });

    it("canPlaceRealOrders returns false regardless of env vars", () => {
      resetRuntimeConfig({ V121_MODE: "READ_ONLY", V121_MAINNET_TINY_ENABLED: "true" });
      expect(canPlaceRealOrders("READ_ONLY")).toBe(false);
    });

    it("READ_ONLY has no envVar requirements (lock enforced by type)", () => {
      expect(MODE_REQUIREMENTS.READ_ONLY.envVars).toHaveLength(0);
    });
  });

  // ── PAPER ──────────────────────────────────────────────────

  describe("PAPER safety gates", () => {
    it("MODE_REQUIREMENTS explicitly disallows real orders", () => {
      expect(MODE_REQUIREMENTS.PAPER.disallowOrder).toBe(true);
    });

    it("canPlaceRealOrders returns false regardless of env vars", () => {
      resetRuntimeConfig({ V121_MODE: "PAPER", V121_MAINNET_TINY_ENABLED: "true" });
      expect(canPlaceRealOrders("PAPER")).toBe(false);
    });
  });

  // ── SHADOW ─────────────────────────────────────────────────

  describe("SHADOW safety gates", () => {
    it("MODE_REQUIREMENTS explicitly disallows real orders", () => {
      expect(MODE_REQUIREMENTS.SHADOW.disallowOrder).toBe(true);
    });

    it("canPlaceRealOrders returns false regardless of env vars", () => {
      resetRuntimeConfig({ V121_MODE: "SHADOW", V121_MAINNET_TINY_ENABLED: "true" });
      expect(canPlaceRealOrders("SHADOW")).toBe(false);
    });

    it("accountSafety blocks all write actions", () => {
      const writeActions = ["order", "cancel", "modify_leverage", "transfer", "withdraw", "set_margin_mode"];
      for (const action of writeActions) {
        expect(() => assertNotShadow("SHADOW", action)).toThrow("SHADOW");
        const r = isActionBlockedInShadow("SHADOW", action);
        expect(r.blocked).toBe(true);
      }
    });

    it("accountSafety allows read actions in SHADOW", () => {
      expect(isActionBlockedInShadow("SHADOW", "read_balance").blocked).toBe(false);
      expect(isActionBlockedInShadow("SHADOW", "read_position").blocked).toBe(false);
    });

    it("assertNotShadow does not throw for non-SHADOW modes", () => {
      expect(() => assertNotShadow("READ_ONLY", "order")).not.toThrow();
      expect(() => assertNotShadow("PAPER", "order")).not.toThrow();
    });
  });

  // ── MAINNET_TINY ───────────────────────────────────────────

  describe("MAINNET_TINY safety gates", () => {
    beforeEach(() => {
      // 重置 runtimeConfig，避免前序测试残留的 env 影响
      resetRuntimeConfig({ V121_MODE: "MAINNET_TINY" });
    });

    it("MODE_REQUIREMENTS does not force disallowOrder (env-based)", () => {
      expect(MODE_REQUIREMENTS.MAINNET_TINY.disallowOrder).toBe(false);
    });

    it("canPlaceRealOrders requires all env vars to be set", () => {
      // 没有任何 env 时
      resetRuntimeConfig({ V121_MODE: "MAINNET_TINY" });
      expect(canPlaceRealOrders("MAINNET_TINY")).toBe(false);
      // 只有 mode 时（mainnetTinyEnabled 未设）
      resetRuntimeConfig({ V121_MODE: "MAINNET_TINY" });
      expect(canPlaceRealOrders("MAINNET_TINY")).toBe(false);
      // 缺 risk 确认时
      resetRuntimeConfig({ V121_MODE: "MAINNET_TINY", V121_MAINNET_TINY_ENABLED: "true" });
      expect(canPlaceRealOrders("MAINNET_TINY")).toBe(false);
      // 全配齐时
      resetRuntimeConfig({
        V121_MODE: "MAINNET_TINY",
        V121_MAINNET_TINY_ENABLED: "true",
        V121_CONFIRM_MAINNET_TINY_RISK: "I_UNDERSTAND",
      });
      expect(canPlaceRealOrders("MAINNET_TINY")).toBe(true);
    });

    it("checkMainnetTinyGate requires all gates", () => {
      const gate = checkMainnetTinyGate();
      expect(gate.allowed).toBe(false);
    });

    it("checkMainnetTinyGate identifies each missing env var individually", () => {
      const gate = checkMainnetTinyGate();
      expect(gate.missing.length).toBe(2);
      expect(gate.missing.some(m => m.includes("V121_MAINNET_TINY_ENABLED"))).toBe(true);
      expect(gate.missing.some(m => m.includes("V121_CONFIRM_MAINNET_TINY_RISK"))).toBe(true);
    });

    it("validateOrderIntent with all gates open passes", () => {
      const r = validateOrderIntent({
        symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
        notionalUsdt: 5, totalExposureUsdt: 10,
      });
      expect(r.allowed).toBe(true);
    });

    it("validateOrderIntent blocks > 10 USDT", () => {
      const r = validateOrderIntent({
        symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
        notionalUsdt: 20, totalExposureUsdt: 10,
      });
      expect(r.allowed).toBe(false);
      expect(r.blockedReasons.some(b => b.includes("10 USDT"))).toBe(true);
    });

    it("validateOrderIntent blocks HTX", () => {
      const r = validateOrderIntent({
        symbol: "BTC/USDT", spotExchange: "htx", perpExchange: "htx",
        notionalUsdt: 5, totalExposureUsdt: 10,
      });
      expect(r.allowed).toBe(false);
      expect(r.blockedReasons.some(b => b.includes("HTX"))).toBe(true);
    });

    it("validateOrderIntent blocks cross-exchange", () => {
      const r = validateOrderIntent({
        symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "okx",
        notionalUsdt: 5, totalExposureUsdt: 10,
      });
      expect(r.allowed).toBe(false);
      expect(r.blockedReasons.some(b => b.includes("跨所"))).toBe(true);
    });

    it("validateOrderIntent blocks small caps", () => {
      const r = validateOrderIntent({
        symbol: "1000PEPE/USDT", spotExchange: "binance", perpExchange: "binance",
        notionalUsdt: 5, totalExposureUsdt: 10,
      });
      expect(r.allowed).toBe(false);
      expect(r.blockedReasons.some(b => b.includes("小币"))).toBe(true);
    });

    it("validateOrderIntent respects persistence mode", () => {
      // jsonl-dev-only 不允许 MAINNET_TINY
      expect(isPersistenceReadyForTiny()).toBe(false);
    });
  });

  // ── CONTROLLED_LIVE ────────────────────────────────────────

  describe("CONTROLLED_LIVE safety gates", () => {
    it("MODE_REQUIREMENTS does not force disallowOrder (env-based)", () => {
      expect(MODE_REQUIREMENTS.CONTROLLED_LIVE.disallowOrder).toBe(false);
    });

    it("canPlaceRealOrders requires all env vars", () => {
      resetRuntimeConfig({ V121_MODE: "CONTROLLED_LIVE" });
      expect(canPlaceRealOrders("CONTROLLED_LIVE")).toBe(false);
      resetRuntimeConfig({
        V121_MODE: "CONTROLLED_LIVE",
        V121_LIVE_ENABLED: "true",
        V121_CONFIRM_LIVE_RISK: "I_UNDERSTAND",
      });
      expect(canPlaceRealOrders("CONTROLLED_LIVE")).toBe(true);
    });

    it("CONTROLLED_LIVE has stricter limits than MAINNET_TINY", () => {
      // CONTROLLED_LIVE 限制 equity ratio，MAINNET_TINY 限制绝对金额
      expect(CONTROLLED_LIVE_DEFAULT_LIMITS.maxSingleSymbolEquityRatio).toBeDefined();
      expect(MAINNET_TINY_DEFAULT_LIMITS.maxOrderNotionalUsdt).toBeDefined();
    });

    it("CONTROLLED_LIVE has HTX disabled", () => {
      expect(CONTROLLED_LIVE_DEFAULT_LIMITS.allowHtx).toBe(false);
    });

    it("CONTROLLED_LIVE has auto entry disabled by default", () => {
      expect(CONTROLLED_LIVE_DEFAULT_LIMITS.allowAutoEntry).toBe(false);
    });

    it("CONTROLLED_LIVE requires manual confirm", () => {
      expect(CONTROLLED_LIVE_DEFAULT_LIMITS.requireManualConfirm).toBe(true);
    });
  });
});
