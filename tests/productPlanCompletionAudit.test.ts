/**
 * Product Plan Completion Audit
 *
 * Audits the V121 product surface inventory, dev-page gating, old-URL
 * redirects, and no-real-trading safety boundaries.
 *
 * Replaces the former originalPlanCompletionAudit tests, which asserted V1.0
 * pages (app/strategies, app/risk-rules, app/api-keys, ...) and a "no mainnet
 * file" rule that false-positive'd on the legitimate lib/strategy-v121/mainnetTiny/*
 * directory.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function read(p: string) { return readFileSync(join(root, p), "utf8"); }
function exists(p: string) { return existsSync(join(root, p)); }

// ─── Product Page Inventory ──────────────────────────────

describe("Product surface — 8 成品页面", () => {
  it("all 8 product pages exist", () => {
    const pages = [
      "app/(app)/dashboard/page.tsx",
      "app/(app)/opportunities/page.tsx",
      "app/(app)/trade/open/page.tsx",
      "app/(app)/trade/close/page.tsx",
      "app/(app)/positions/page.tsx",
      "app/(app)/risk/page.tsx",
      "app/(app)/settings/page.tsx",
      "app/(app)/review/page.tsx",
    ];
    for (const p of pages) expect(exists(p)).toBe(true);
  });

  it("homepage redirects to /dashboard", () => {
    expect(read("app/page.tsx")).toContain("/dashboard");
  });
});

// ─── Dev Pages Gated ─────────────────────────────────────

describe("Dev pages — V121_ENABLE_DEV_TOOLS 门禁", () => {
  it("app/v121/layout.tsx gates with notFound()", () => {
    const layout = read("app/v121/layout.tsx");
    expect(layout).toContain("V121_ENABLE_DEV_TOOLS");
    expect(layout).toContain("notFound");
  });

  const DEV_PAGES = [
    "app/v121/intents/page.tsx",
    "app/v121/shadow/page.tsx",
    "app/v121/mainnet-tiny/page.tsx",
    "app/v121/mainnet-tiny/final-audit/page.tsx",
  ];
  for (const p of DEV_PAGES) {
    it(`${p} exists (dev-gated by layout)`, () => { expect(exists(p)).toBe(true); });
  }
});

// ─── Old URL Redirects ───────────────────────────────────

describe("Old /v121/* URLs redirect to product pages", () => {
  it("next.config.ts maps legacy /v121/* to product routes (permanent: false)", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain("/v121/dashboard");
    expect(cfg).toContain("/v121/opportunities");
    expect(cfg).toContain("/v121/execution");
    expect(cfg).toContain("/v121/positions");
    expect(cfg).toContain("/v121/risk-center");
    expect(cfg).toContain("/v121/settings");
    expect(cfg).toContain("/v121/review");
  });
});

// ─── Old V1.0 Pages Removed ──────────────────────────────

describe("Old V1.0 pages — 已移除", () => {
  for (const p of [
    "app/execution/page.tsx",
    "app/strategies/page.tsx",
    "app/risk-rules/page.tsx",
    "app/api-keys/page.tsx",
  ]) {
    it(`${p} does NOT exist`, () => { expect(exists(p)).toBe(false); });
  }
});

// ─── Safety Boundaries ───────────────────────────────────

describe("Safety boundaries — 无真实交易", () => {
  it("all /api/testnet routes still blocked", () => {
    const routes = [
      "app/api/testnet/orders/preview-submit/route.ts",
      "app/api/testnet/orders/cancel/route.ts",
      "app/api/testnet/orders/[id]/route.ts",
      "app/api/testnet/account/snapshot/route.ts",
    ];
    for (const f of routes) {
      const content = read(f);
      const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(noComments).not.toContain("success: true");
    }
  });

  it("no submitLiveOrder / placeLiveOrder in app/lib", () => {
    const terms = ["submitLiveOrder", "placeLiveOrder"];
    for (const dir of ["app", "lib"]) {
      function walk(d: string): void {
        if (!exists(d)) return;
        for (const entry of readdirSync(join(root, d), { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(full);
          else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
            const content = readFileSync(join(root, full), "utf8");
            const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            for (const term of terms) {
              expect(noComments, `${full} contains ${term}`).not.toContain(term);
            }
          }
        }
      }
      walk(dir);
    }
  });

  it("middleware not opened for /api/testnet", () => {
    const mw = read("middleware.ts");
    const paths = mw.match(/\/api\/[a-z-]+/g) || [];
    expect(paths.find((p) => p.includes("testnet"))).toBeUndefined();
  });
});
