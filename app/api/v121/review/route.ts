import { NextResponse } from "next/server";
import { FileSystemRepository } from "@/lib/strategy-v121/persistence/fileSystemRepository";
import { listRecentClosePlans } from "@/lib/strategy-v121/position/closePlanLedger";
import { listRecentCloseExecutions } from "@/lib/strategy-v121/position/closeExecutionLedger";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

/**
 * GET /api/v121/review — 复盘记录。
 *
 * 7 张核心表 + 平仓方案（close_plan_ledger）+ 平仓执行（close_execution_ledger）。
 * 平仓两类记录走 getRepository()（与执行链一致的存储后端），最近 50 条。
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

  // 平仓闭环记录：方案 + 执行（最近 50 条）
  const [closePlans, closeExecutions] = await Promise.all([
    listRecentClosePlans(50).catch(() => []),
    listRecentCloseExecutions(50).catch(() => []),
  ]);
  result.close_plans = closePlans;
  result.close_executions = closeExecutions;
  total += closePlans.length + closeExecutions.length;

  return NextResponse.json({
    ...result,
    persistence: "jsonl-dev-only",
    persistenceLabel: "Development persistence only. Not approved for MAINNET_TINY.",
    totalRecords: total,
  });
}
