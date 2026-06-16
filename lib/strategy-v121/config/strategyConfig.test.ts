import { describe, it, expect } from "vitest";
import {
  MAINNET_TINY_DEFAULT_LIMITS,
  CONTROLLED_LIVE_DEFAULT_LIMITS,
  MODE_REQUIREMENTS,
  canPlaceRealOrders,
} from "./strategyConfig";

describe("MODE_REQUIREMENTS", () => {
  it("READ_ONLY disallows real orders", () => {
    expect(MODE_REQUIREMENTS.READ_ONLY.disallowOrder).toBe(true);
  });

  it("PAPER disallows real orders", () => {
    expect(MODE_REQUIREMENTS.PAPER.disallowOrder).toBe(true);
  });

  it("SHADOW disallows real orders", () => {
    expect(MODE_REQUIREMENTS.SHADOW.disallowOrder).toBe(true);
  });

  it("MAINNET_TINY requires env vars to place real orders", () => {
    expect(MODE_REQUIREMENTS.MAINNET_TINY.disallowOrder).toBe(false);
    expect(MODE_REQUIREMENTS.MAINNET_TINY.envVars).toContain("V121_MAINNET_TINY_ENABLED=true");
    expect(MODE_REQUIREMENTS.MAINNET_TINY.envVars).toContain("V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND");
  });

  it("CONTROLLED_LIVE requires confirmation env var", () => {
    expect(MODE_REQUIREMENTS.CONTROLLED_LIVE.disallowOrder).toBe(false);
    expect(MODE_REQUIREMENTS.CONTROLLED_LIVE.envVars).toContain("V121_CONFIRM_LIVE_RISK=I_UNDERSTAND");
  });
});

describe("canPlaceRealOrders", () => {
  it("READ_ONLY cannot place real orders", () => {
    expect(canPlaceRealOrders("READ_ONLY", {})).toBe(false);
  });

  it("PAPER cannot place real orders", () => {
    expect(canPlaceRealOrders("PAPER", {})).toBe(false);
  });

  it("SHADOW cannot place real orders", () => {
    expect(canPlaceRealOrders("SHADOW", { "V121_MODE": "SHADOW" })).toBe(false);
  });

  it("MAINNET_TINY without env vars cannot place real orders", () => {
    expect(canPlaceRealOrders("MAINNET_TINY", {})).toBe(false);
  });

  it("MAINNET_TINY with correct env vars can place real orders", () => {
    expect(canPlaceRealOrders("MAINNET_TINY", {
      "V121_MODE": "MAINNET_TINY",
      "V121_MAINNET_TINY_ENABLED": "true",
      "V121_CONFIRM_MAINNET_TINY_RISK": "I_UNDERSTAND",
    })).toBe(true);
  });

  it("CONTROLLED_LIVE without env vars cannot place real orders", () => {
    expect(canPlaceRealOrders("CONTROLLED_LIVE", {})).toBe(false);
  });

  it("CONTROLLED_LIVE with correct env vars can place real orders", () => {
    expect(canPlaceRealOrders("CONTROLLED_LIVE", {
      "V121_MODE": "CONTROLLED_LIVE",
      "V121_LIVE_ENABLED": "true",
      "V121_CONFIRM_LIVE_RISK": "I_UNDERSTAND",
    })).toBe(true);
  });
});

describe("MAINNET_TINY_DEFAULT_LIMITS", () => {
  it("max order 10 USDT", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.maxOrderNotionalUsdt).toBe(10);
  });
  it("total exposure 50 USDT", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.maxTotalExposureUsdt).toBe(50);
  });
  it("max 3 trades per day", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.maxDailyTrades).toBe(3);
  });
  it("leverage 1x", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.leverage).toBe(1);
  });
  it("HTX disabled", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.allowHtx).toBe(false);
  });
  it("small caps disabled", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.allowSmallCaps).toBe(false);
  });
  it("cross exchange disabled", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.allowCrossExchange).toBe(false);
  });
  it("auto entry disabled", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.allowAutoEntry).toBe(false);
  });
  it("manual confirm required", () => {
    expect(MAINNET_TINY_DEFAULT_LIMITS.requireManualConfirm).toBe(true);
  });
});

describe("CONTROLLED_LIVE_DEFAULT_LIMITS", () => {
  it("single symbol <= 3% equity", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.maxSingleSymbolEquityRatio).toBe(0.03);
  });
  it("total <= 30% equity", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.maxTotalEquityRatio).toBe(0.30);
  });
  it("leverage 1x", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.leverage).toBe(1);
  });
  it("HTX disabled", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.allowHtx).toBe(false);
  });
  it("small caps disabled", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.allowSmallCaps).toBe(false);
  });
  it("auto entry disabled", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.allowAutoEntry).toBe(false);
  });
  it("manual confirm required", () => {
    expect(CONTROLLED_LIVE_DEFAULT_LIMITS.requireManualConfirm).toBe(true);
  });
});
