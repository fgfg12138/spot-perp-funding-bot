import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { getPersistenceMode, isPersistenceReadyForTiny } from "@/lib/strategy-v121/persistence/persistenceMode";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";
import { ALL_TABLE_NAMES } from "@/lib/strategy-v121/persistence/sqliteSchema";

/** GET /api/v121/persistence/status */
export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const mode = getPersistenceMode();
  const repo = getRepository();

  const tableCounts: Record<string, number> = {};
  for (const table of ALL_TABLE_NAMES) {
    tableCounts[table] = repo.count(table);
  }

  const json = JSON.stringify(tableCounts);
  const secretOk = !json.includes("API_KEY") && !json.includes("API_SECRET") && !json.includes("PASSPHRASE");

  return NextResponse.json({
    mode,
    readyForTiny: isPersistenceReadyForTiny(),
    tableCounts,
    totalRecords: Object.values(tableCounts).reduce((a, b) => a + b, 0),
    secretExposureCheck: secretOk ? "passed" : "failed",
  });
}
