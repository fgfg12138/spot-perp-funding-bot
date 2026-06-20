/**
 * V1.2.1 Worker / Daemon
 *
 * Run:          npx tsx scripts/v121-worker.ts
 * Dry run:      V121_MODE=PAPER V121_DRY_RUN=1 npx tsx scripts/v121-worker.ts
 *
 * Reads config from environment variables and starts the V1.2.1 worker loop.
 * Does not place real orders in READ_ONLY, PAPER, or SHADOW modes.
 */

import { V121Worker } from "../lib/strategy-v121/worker/worker";
import { updateConfig, getConfig } from "../lib/strategy-v121/config/strategyConfig";

function main() {
  const mode = process.env.V121_MODE ?? "READ_ONLY";
  const dryRun = process.env.V121_DRY_RUN === "1";
  const intervalMs = Number(process.env.V121_WORKER_INTERVAL_MS) || 10_000;

  updateConfig({ mode: mode as any });
  if (dryRun) console.log("DRY RUN — no real actions");

  const worker = new V121Worker({
    workerId: `v121-worker-${Date.now()}`,
    intervalMs,
  }, dryRun);

  console.log(`\nV1.2.1 Worker starting`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Interval: ${intervalMs / 1000}s`);
  console.log(`  Persistence: ${process.env.V121_PERSISTENCE_MODE ?? "jsonl-dev-only"}`);
  console.log(`  SQLite path: ${process.env.V121_SQLITE_PATH ?? ".v121-data/v121.sqlite"}`);
  console.log(`  Dynamic universe: ${process.env.V121_WORKER_USE_DYNAMIC_UNIVERSE ?? "false"}`);
  console.log(`  Scan mode: ${process.env.V121_WORKER_SCAN_MODE ?? "fixed/default"}`);

  worker.start();

  process.on("SIGINT", () => {
    console.log("\nStopping worker...");
    worker.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("\nStopping worker (SIGTERM)...");
    worker.stop();
    process.exit(0);
  });
}

main();
