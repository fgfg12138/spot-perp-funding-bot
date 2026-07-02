import { describe, expect, it, beforeEach } from "vitest";
import { checkMainnetTinyGate, validateOrderIntent } from "./mainnetTinyGate";
import { resetRuntimeConfig } from "../config/runtimeConfig";

describe("mainnetTinyGate", () => {
  beforeEach(() => {
    delete process.env.V121_MODE;
    delete process.env.V121_MAINNET_TINY_ENABLED;
    delete process.env.V121_CONFIRM_MAINNET_TINY_RISK;
    delete process.env.V121_LIVE_ENABLED;
    resetRuntimeConfig();
  });

  it("缺所有 env 时 allowed=false", () => {
    const gate = checkMainnetTinyGate();
    expect(gate.allowed).toBe(false);
    expect(gate.missing.length).toBeGreaterThan(1);
  });

  it("全配齐时 allowed=true", () => {
    process.env.V121_MODE = "MAINNET_TINY";
    process.env.V121_MAINNET_TINY_ENABLED = "true";
    process.env.V121_CONFIRM_MAINNET_TINY_RISK = "I_UNDERSTAND";
    resetRuntimeConfig();
    const gate = checkMainnetTinyGate();
    expect(gate.allowed).toBe(true);
    expect(gate.missing).toHaveLength(0);
  });

  it("缺 risk confirmation 时 blocked", () => {
    process.env.V121_MODE = "MAINNET_TINY";
    process.env.V121_MAINNET_TINY_ENABLED = "true";
    resetRuntimeConfig();
    const gate = checkMainnetTinyGate();
    expect(gate.allowed).toBe(false);
  });
});

describe("validateOrderIntent", () => {
  it("正常小金额通过", () => {
    const r = validateOrderIntent({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
      notionalUsdt: 5, totalExposureUsdt: 10,
    });
    expect(r.allowed).toBe(true);
  });

  it("超 10 USDT blocked", () => {
    const r = validateOrderIntent({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
      notionalUsdt: 20, totalExposureUsdt: 10,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons.some(b => b.includes("10 USDT"))).toBe(true);
  });

  it("HTX blocked", () => {
    const r = validateOrderIntent({
      symbol: "BTC/USDT", spotExchange: "htx", perpExchange: "htx",
      notionalUsdt: 5, totalExposureUsdt: 10,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons.some(b => b.includes("HTX"))).toBe(true);
  });

  it("跨所 blocked", () => {
    const r = validateOrderIntent({
      symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "okx",
      notionalUsdt: 5, totalExposureUsdt: 10,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons.some(b => b.includes("跨所"))).toBe(true);
  });

  it("小币 blocked", () => {
    const r = validateOrderIntent({
      symbol: "1000PEPE/USDT", spotExchange: "binance", perpExchange: "binance",
      notionalUsdt: 5, totalExposureUsdt: 10,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons.some(b => b.includes("小币"))).toBe(true);
  });
});
