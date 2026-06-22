/**
 * Strategy Template Tests — Recovery R2 (updated for V121 product surface)
 *
 * The V1.0 /strategies page + StrategyManager.tsx were removed during V121
 * productization (the product surface is /trade/open, /trade/close, /positions
 * under app/(app)/layout.tsx). The underlying strategy template lib
 * (lib/strategies/types.ts, strategyStore.ts) is retained for the strategy
 * config layer. This file now asserts: (a) the lib template types/clone
 * function still exist, (b) the V1.0 UI files are gone.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloneStrategy } from "@/lib/strategies/strategyStore";

const root = process.cwd();
function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

// ─── Types include template fields ─────────────────────

describe("Strategy Types — Template Fields", () => {
  const types = read("lib/strategies/types.ts");

  it("defines StrategyTemplateCategory", () => {
    expect(types).toContain("StrategyTemplateCategory");
  });

  it("includes templateCategory in StrategyBase", () => {
    expect(types).toContain("templateCategory?: StrategyTemplateCategory");
  });

  it("includes maxPositionUsd", () => {
    expect(types).toContain("maxPositionUsd?");
  });

  it("includes maxCapitalUsagePercent", () => {
    expect(types).toContain("maxCapitalUsagePercent?");
  });

  it("includes minNetRate", () => {
    expect(types).toContain("minNetRate?");
  });

  it("includes stopLossPercent", () => {
    expect(types).toContain("stopLossPercent?");
  });

  it("includes takeProfitPercent", () => {
    expect(types).toContain("takeProfitPercent?");
  });

  it("includes autoCloseWhenFundingBelow", () => {
    expect(types).toContain("autoCloseWhenFundingBelow?");
  });

  it("includes enabledPaperTrading", () => {
    expect(types).toContain("enabledPaperTrading?");
  });
});

// ─── Clone Function in Store ─────────────────────────────

describe("Strategy Store — cloneStrategy", () => {
  const store = read("lib/strategies/strategyStore.ts");

  it("exports cloneStrategy function", () => {
    expect(store).toContain("cloneStrategy");
  });

  it("appends (Clone) to name", () => {
    expect(store).toContain("(Clone)");
  });

  it("resets status to draft", () => {
    expect(store).toContain('status: "draft"');
  });
});

// ─── V1.0 Strategy UI Removed ───────────────────────────

describe("V1.0 Strategy UI — 已移除", () => {
  it("app/strategies/StrategyManager.tsx has been removed (V1.0 residue)", () => {
    expect(existsSync(join(root, "app/strategies/StrategyManager.tsx"))).toBe(false);
  });

  it("app/strategies/page.tsx has been removed (V1.0 residue)", () => {
    expect(existsSync(join(root, "app/strategies/page.tsx"))).toBe(false);
  });
});
