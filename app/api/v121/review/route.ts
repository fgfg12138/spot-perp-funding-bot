import { NextResponse } from "next/server";
import { FileSystemRepository } from "@/lib/strategy-v121/persistence/fileSystemRepository";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

/**
 * GET /api/v121/review — review records from 7 core tables
 */
export async function GET() {
  const tables = [
    "opportunity_records", "entry_decisions", "entry_executions",
    "position_snapshots", "funding_settlements",
    "exit_executions", "final_reviews",
  ];

  const result: Record<string, unknown> = {};
  let total = 0;
  for (const table of tables) {
    const rows = repo.queryAll(table);
    result[table] = rows;
    total += rows.length;
  }

  return NextResponse.json({
    ...result,
    persistence: "jsonl-dev-only",
    persistenceLabel: "Development persistence only. Not approved for MAINNET_TINY.",
    totalRecords: total,
  });
}
