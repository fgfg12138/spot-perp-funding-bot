/**
 * SQLite 扩展表 DDL — 在 7 核心表之外的新增表。
 */
export const EXTRA_TABLES: Record<string, string> = {
  PAPER_EXECUTIONS: `
    CREATE TABLE IF NOT EXISTS paper_executions (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'IDLE',
      symbol TEXT NOT NULL,
      spot_exchange TEXT NOT NULL,
      perp_exchange TEXT NOT NULL,
      total_notional REAL NOT NULL DEFAULT 0,
      spot_filled_qty REAL DEFAULT 0,
      perp_filled_qty REAL DEFAULT 0,
      spot_notional REAL DEFAULT 0,
      perp_notional REAL DEFAULT 0,
      deviation REAL DEFAULT 0,
      logs TEXT DEFAULT '[]',
      created_at_utc INTEGER NOT NULL,
      updated_at_utc INTEGER NOT NULL
    );
  `,
  LATEST_SCAN: `
    CREATE TABLE IF NOT EXISTS latest_scan (
      id TEXT PRIMARY KEY,
      total_paths INTEGER DEFAULT 0,
      passed_count INTEGER DEFAULT 0,
      rejected_count INTEGER DEFAULT 0,
      data_source TEXT DEFAULT 'no_data',
      scanned_at_utc INTEGER NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      errors_json TEXT DEFAULT '[]',
      reject_summary_json TEXT DEFAULT '{}'
    );
  `,
  ORDER_INTENTS: `
    CREATE TABLE IF NOT EXISTS order_intents (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      symbol TEXT NOT NULL,
      spot_exchange TEXT NOT NULL,
      perp_exchange TEXT NOT NULL,
      planned_notional REAL NOT NULL,
      gate_allowed INTEGER DEFAULT 0,
      blocked_reasons TEXT DEFAULT '[]',
      created_at_utc INTEGER NOT NULL
    );
  `,
  BLOCKED_EXECUTION_ATTEMPTS: `
    CREATE TABLE IF NOT EXISTS blocked_execution_attempts (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      action TEXT NOT NULL,
      symbol TEXT,
      reason TEXT NOT NULL,
      blocked_at_utc INTEGER NOT NULL
    );
  `,
  WORKER_HEARTBEATS: `
    CREATE TABLE IF NOT EXISTS worker_heartbeat (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'stopped',
      mode TEXT NOT NULL,
      last_cycle_at_utc INTEGER NOT NULL,
      cycle_count INTEGER DEFAULT 0,
      last_error TEXT
    );
  `,
};

export function getExtraCreateSQL(): string[] {
  return Object.values(EXTRA_TABLES);
}

export const ALL_TABLE_NAMES = [
  "opportunity_records", "entry_decisions", "entry_executions",
  "position_snapshots", "funding_settlements", "exit_executions", "final_reviews",
  "paper_executions", "latest_scan", "order_intents",
  "blocked_execution_attempts", "worker_heartbeat",
];
