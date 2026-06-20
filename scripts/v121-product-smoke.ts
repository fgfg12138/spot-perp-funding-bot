/**
 * V121 Product Smoke Test
 *
 * Checks all critical v121 API endpoints are reachable.
 * Does not touch real funds.
 *
 * Run: npx tsx scripts/v121-product-smoke.ts
 */

const BASE = process.env.V121_BASE_URL ?? "http://localhost:3000";

const ENDPOINTS = [
  { path: "/api/v121/health", name: "Health" },
  { path: "/api/v121/worker", name: "Worker status" },
  { path: "/api/v121/risk", name: "Risk state" },
  { path: "/api/v121/opportunities", name: "Opportunities" },
  { path: "/api/v121/mainnet-tiny/preflight", name: "Preflight" },
  { path: "/api/v121/mainnet-tiny/intents", name: "Intents" },
  { path: "/api/v121/mainnet-tiny/order-plan", name: "Order plans" },
  { path: "/api/v121/mainnet-tiny/order-execution", name: "Order executions" },
  { path: "/api/v121/settings", name: "Settings" },
  { path: "/api/v121/shadow", name: "Shadow diagnostics" },
  { path: "/api/v121/review", name: "Review" },
  { path: "/api/v121/positions", name: "Positions" },
];

async function main() {
  let passed = 0;
  let failed = 0;

  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(`${BASE}${ep.path}`, { signal: AbortSignal.timeout(10000) });
      const body = await res.json();
      if (res.ok && body) {
        console.log(`  ✅ ${ep.name} (${ep.path})`);
        passed++;
      } else {
        console.log(`  ❌ ${ep.name} (${ep.path}) — HTTP ${res.status}`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ❌ ${ep.name} (${ep.path}) — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nV121 Product Smoke: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
