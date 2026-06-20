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

describe("schema compatibility", () => {
  it("DDL includes purpose/simulationOnly/realTradeEligible in order_intents", async () => {
    const { EXTRA_TABLES } = await import("../persistence/sqliteSchema");
    const ddl = EXTRA_TABLES.ORDER_INTENTS;
    expect(ddl).toContain("purpose TEXT DEFAULT 'real_arbitrage'");
    expect(ddl).toContain("simulationOnly INTEGER DEFAULT 0");
    expect(ddl).toContain("realTradeEligible INTEGER DEFAULT 0");
  });

  it("user_strategy_settings DDL has both json and settings_json (nullable)", async () => {
    const { EXTRA_TABLES } = await import("../persistence/sqliteSchema");
    const ddl = EXTRA_TABLES.USER_STRATEGY_SETTINGS;
    expect(ddl).toContain("json TEXT");
    expect(ddl).toContain("settings_json TEXT");
    // created_at_utc should stay NOT NULL
    expect(ddl).toContain("created_at_utc INTEGER NOT NULL");
  });

  it("migration patches include purpose/simulationOnly/realTradeEligible", async () => {
    const { EXTRA_TABLES } = await import("../persistence/sqliteSchema");
    const patches = EXTRA_TABLES.ORDER_INTENTS;
    expect(patches).toContain("purpose");
    expect(patches).toContain("simulationOnly");
    expect(patches).toContain("realTradeEligible");
  });
});
