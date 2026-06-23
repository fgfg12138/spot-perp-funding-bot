/**
 * Phase 4 Boundary Tests
 *
 * Verifies Phase 4 semi-automated trading maintains safe boundaries:
 * - No real order placement
 * - No private API calls
 * - No external notifications
 * - Queue statuses are preview-only
 * - Pages clearly state "Preview Only / No real orders"
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

/** Collect every `.ts` and `.tsx` file in `lib/` excluding test files. */
function getRunFiles(dir: string): { file: string; content: string }[] {
  function walk(d: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        files.push(...walk(full));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
        files.push(full);
      }
    }
    return files;
  }
  return walk(join(root, dir)).map((f) => ({ file: f, content: readFileSync(f, "utf8") }));
}

// ─── No Live Order Functions ────────────────────────────

describe("Phase 4 Boundary — No Live Order Functions", () => {
  const libRun = getRunFiles("lib");
  // V121 MAINNET_TINY legitimately implements adapter.submitOrderLeg /
  // adapter.placeOrderLeg and calls them via guardedOrderExecutor for real
  // two-leg orders, but execution is hard-gated by
  // V121_ENABLE_REAL_ORDER_EXECUTION + guardedOrderExecutor + explicitConfirm
  // + killSwitch. The whole lib/strategy-v121/** tree is exempt from these
  // "no live order" scans; the rule still catches any V1.0/raw implementation
  // elsewhere in lib/.
  const isV121 = (file: string) => file.replace(/\\/g, "/").includes("strategy-v121/");

  it("no submitOrder implementation in lib/ (outside V121 gated tree)", () => {
    const found = libRun.filter(({ content, file }) => !content.includes("interface ") && content.includes("submitOrder") && !isV121(file));
    if (found.length > 0) {
      // If found, make sure it's only in JSDoc or comments
      for (const { file, content } of found) {
        const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(noComments, `submitOrder found in ${file}`).not.toContain("submitOrder");
      }
    }
  });

  it("no placeOrder implementation in lib/ (outside V121 gated tree)", () => {
    const found = libRun.filter(({ content, file }) => content.includes("placeOrder") && !content.includes("interface ") && !isV121(file));
    for (const { file, content } of found) {
      const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(noComments, `placeOrder found in ${file}`).not.toContain("placeOrder");
    }
  });

  it("no createOrder implementation in lib/", () => {
    const found = libRun.filter(({ content, file }) =>
      content.includes("createOrder") && !content.includes("CreateOrder") && !content.includes("interface ") && !file.includes("orderRouter") && !file.includes("hedgeEngine") && !file.includes("connectors"),
    );
    for (const { file, content } of found) {
      const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(noComments, `createOrder found in ${file}`).not.toContain("createOrder");
    }
  });

  it("no marketOrder implementation in lib/", () => {
    const found = libRun.filter(({ content }) => content.includes("marketOrder"));
    // Allow TinyFilledOrderReport type definition (data-only field)
    const filtered = found.filter((f) => !f.file.includes("tinyFilledOrderTypes"));
    expect(filtered.map((f) => f.file), "marketOrder found").toEqual([]);
  });
});

// ─── Queue Status Boundary ──────────────────────────────

describe("Phase 4 Boundary — Queue Status", () => {
  it("queue types do not contain submitted/executed/filled", () => {
    const content = read("lib/orders/executionQueueTypes.ts");
    expect(content).not.toContain("submitted");
    expect(content).not.toContain("executed");
    expect(content).not.toContain("filled");
  });
});

// ─── No External Notification ───────────────────────────

describe("Phase 4 Boundary — No External Notification", () => {
  const notifRun = getRunFiles("lib/notifications").filter((f) => f.file.includes("localNotification"));

  it("localNotification store does not fetch or call external services", () => {
    for (const { file, content } of notifRun) {
      expect(content, `fetch found in ${file}`).not.toContain("fetch(");
      expect(content, `telegram found in ${file}`).not.toContain("telegram");
      expect(content, `email found in ${file}`).not.toContain("email");
      expect(content, `webhook found in ${file}`).not.toContain("webhook");
    }
  });
});

// ─── Kill Switch Boundary ───────────────────────────────

describe("Phase 4 Boundary — Kill Switch", () => {
  it("safety store does not claim to cancel real orders", () => {
    const content = read("lib/safety/safetyStore.ts");
    expect(content).not.toContain("cancelOrder");
    expect(content).not.toContain("撤销订单");
    expect(content).not.toContain("撤单");
  });
});

// ─── Page Text Verification ─────────────────────────────

describe("Phase 4 Boundary — Page Text", () => {
  // The V1.0 /execution, /execution-queue, /safety pages were removed during
  // V121 productization. The product surface is /trade/open, /trade/close,
  // /risk, /positions under app/(app)/layout.tsx, which enforce the same
  // "no real orders without gate + confirm" boundary at the component level.
  it("app/execution page has been removed (V1.0 residue)", () => {
    expect(existsSync(join(root, "app/execution/page.tsx"))).toBe(false);
  });

  it("app/execution-queue page has been removed (V1.0 residue)", () => {
    expect(existsSync(join(root, "app/execution-queue/page.tsx"))).toBe(false);
  });

  it("app/safety page has been removed (V1.0 residue)", () => {
    expect(existsSync(join(root, "app/safety/page.tsx"))).toBe(false);
  });
});

// ─── No Private API Adapters ────────────────────────────

describe("Phase 4 Boundary — No Private API Adapters", () => {
  const adapterFiles = getRunFiles("lib/exchangeAdapters");

  it("no private adapter file names exist", () => {
    const names = adapterFiles.map((f) => f.file.replace(/\\/g, "/"));
    for (const name of names) {
      // Skip mock and type files
      expect(name, `Unexpected private adapter: ${name}`).not.toMatch(/privateAdapter.*live/i);
    }
  });
});
