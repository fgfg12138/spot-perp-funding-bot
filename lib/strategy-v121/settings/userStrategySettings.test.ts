import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_STRATEGY_SETTINGS,
  normalizeSettings,
  validateSettings,
} from "./userStrategySettings";

describe("DEFAULT_USER_STRATEGY_SETTINGS", () => {
  it("minSpotVolume24hUsdt > 0", () => {
    expect(DEFAULT_USER_STRATEGY_SETTINGS.universe.minSpotVolume24hUsdt).toBeGreaterThan(0);
  });

  it("minPerpVolume24hUsdt > 0", () => {
    expect(DEFAULT_USER_STRATEGY_SETTINGS.universe.minPerpVolume24hUsdt).toBeGreaterThan(0);
  });
});

describe("normalizeSettings", () => {
  it("empty object returns non-zero volume defaults", () => {
    const r = normalizeSettings({});
    expect(r.universe.minSpotVolume24hUsdt).toBeGreaterThan(0);
    expect(r.universe.minPerpVolume24hUsdt).toBeGreaterThan(0);
  });

  it("null input returns defaults", () => {
    const r = normalizeSettings(null);
    expect(r.universe.minSpotVolume24hUsdt).toBeGreaterThan(0);
    expect(r.universe.minPerpVolume24hUsdt).toBeGreaterThan(0);
  });
});

describe("validateSettings", () => {
  it("rejects negative minSpotVolume24hUsdt", () => {
    const s = { ...DEFAULT_USER_STRATEGY_SETTINGS, universe: { ...DEFAULT_USER_STRATEGY_SETTINGS.universe, minSpotVolume24hUsdt: -1 } };
    const errors = validateSettings(s);
    expect(errors.some((e: string) => e.includes("minSpotVolume24hUsdt"))).toBe(true);
  });

  it("rejects negative minPerpVolume24hUsdt", () => {
    const s = { ...DEFAULT_USER_STRATEGY_SETTINGS, universe: { ...DEFAULT_USER_STRATEGY_SETTINGS.universe, minPerpVolume24hUsdt: -1 } };
    const errors = validateSettings(s);
    expect(errors.some((e: string) => e.includes("minPerpVolume24hUsdt"))).toBe(true);
  });
});
