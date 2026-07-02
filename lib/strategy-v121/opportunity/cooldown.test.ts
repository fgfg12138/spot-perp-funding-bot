import { describe, expect, it } from "vitest";
import { createCooldown, isInCooldown, pruneExpiredCooldowns } from "./cooldown";

describe("cooldown", () => {
  it("entry_failure creates 30min cooldown", () => {
    const cd = createCooldown("binance:binance:BTC/USDT", "entry_failure");
    expect(cd.durationMinutes).toBe(30);
  });

  it("stop_loss creates 24h cooldown", () => {
    const cd = createCooldown("binance:binance:BTC/USDT", "stop_loss");
    expect(cd.durationMinutes).toBe(1440);
  });

  it("detects active cooldown", () => {
    const cd = createCooldown("binance:binance:BTC/USDT", "entry_failure");
    const r = isInCooldown("binance:binance:BTC/USDT", [cd]);
    expect(r.inCooldown).toBe(true);
    expect(r.remainingMinutes).toBeGreaterThan(0);
  });

  it("returns false for non-matching path", () => {
    const cd = createCooldown("binance:binance:BTC/USDT", "entry_failure");
    const r = isInCooldown("okx:okx:ETH/USDT", [cd]);
    expect(r.inCooldown).toBe(false);
  });

  it("pruneExpiredCooldowns removes expired entries", () => {
    const oldCd = {
      ...createCooldown("test:test:TEST", "entry_failure"),
      startedAtUtc: Date.now() - 40 * 60 * 1000,
    };
    const pruned = pruneExpiredCooldowns([oldCd]);
    expect(pruned).toHaveLength(0);
  });
});
