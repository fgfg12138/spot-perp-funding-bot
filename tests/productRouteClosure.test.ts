/**
 * Product Route Closure Tests
 *
 * Verifies the V121 product surface: the 8 product pages exist under
 * app/(app)/, the old V1.0 pages are gone, and the no-real-trading safety
 * boundaries are preserved.
 *
 * Replaces the former originalProductPlanClosure tests, which asserted V1.0
 * pages (app/execution, app/strategies, app/api/strategies/[id]/clone, ...)
 * that no longer exist.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function read(p: string) { return readFileSync(join(root, p), "utf8"); }
function exists(p: string) { return existsSync(join(root, p)); }

// ─── Product Pages Exist ─────────────────────────────────

describe("Product pages — 8 成品页面存在", () => {
  const PRODUCT_PAGES = [
    "app/(app)/dashboard/page.tsx",
    "app/(app)/opportunities/page.tsx",
    "app/(app)/trade/open/page.tsx",
    "app/(app)/trade/close/page.tsx",
    "app/(app)/positions/page.tsx",
    "app/(app)/risk/page.tsx",
    "app/(app)/settings/page.tsx",
    "app/(app)/review/page.tsx",
  ];
  for (const p of PRODUCT_PAGES) {
    it(`${p} exists`, () => { expect(exists(p)).toBe(true); });
  }
});

// ─── Old V1.0 Pages Removed ──────────────────────────────

describe("Old V1.0 pages — 已移除", () => {
  const REMOVED = [
    "app/execution/page.tsx",
    "app/strategies/page.tsx",
    "app/risk-rules/page.tsx",
    "app/api-keys/page.tsx",
    "app/api/strategies/[id]/clone/route.ts",
  ];
  for (const p of REMOVED) {
    it(`${p} does NOT exist`, () => { expect(exists(p)).toBe(false); });
  }
});

// ─── Safety Boundaries (preserved) ───────────────────────

describe("Safety boundaries — 无真实交易", () => {
  it("middleware not opened for /api/testnet", () => {
    const mw = read("middleware.ts");
    const paths = mw.match(/\/api\/[a-z-]+/g) || [];
    expect(paths.find((p) => p.includes("testnet"))).toBeUndefined();
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

  it("all /api/testnet routes still return no success:true", () => {
    const routes = [
      "app/api/testnet/orders/preview-submit/route.ts",
      "app/api/testnet/orders/cancel/route.ts",
      "app/api/testnet/orders/[id]/route.ts",
      "app/api/testnet/account/snapshot/route.ts",
    ];
    for (const f of routes) {
      const content = read(f);
      const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(noComments, `${f} contains success:true`).not.toContain("success: true");
    }
  });
});
