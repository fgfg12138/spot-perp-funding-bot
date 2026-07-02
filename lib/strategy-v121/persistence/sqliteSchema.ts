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
      intentId TEXT,
      mode TEXT NOT NULL,
      symbol TEXT NOT NULL,
      spotExchange TEXT NOT NULL,
      perpExchange TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'buy_spot_short_perp',
      plannedNotionalUsdt REAL NOT NULL,
      batchNo INTEGER DEFAULT 1,
      reason TEXT,
      createdAtUtc INTEGER NOT NULL,
      gateAllowed INTEGER DEFAULT 0,
      blockedReasons TEXT DEFAULT '[]',
      requiresManualConfirm INTEGER DEFAULT 1,
      manualConfirmPassed INTEGER DEFAULT 0,
      dryRun INTEGER DEFAULT 1,
      realOrderExecutionEnabled INTEGER DEFAULT 0,
      purpose TEXT DEFAULT 'real_arbitrage',
      simulationOnly INTEGER DEFAULT 0,
      realTradeEligible INTEGER DEFAULT 0,
      dataSource TEXT DEFAULT 'order_intent'
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
  USER_STRATEGY_SETTINGS: `
    CREATE TABLE IF NOT EXISTS user_strategy_settings (
      id TEXT PRIMARY KEY,
      json TEXT,
      settings_json TEXT,
      created_at_utc INTEGER NOT NULL,
      updated_at_utc INTEGER NOT NULL
    );
  `,
  INTERNAL_TRANSFER_LEDGER: `
    CREATE TABLE IF NOT EXISTS internal_transfer_ledger (
      id TEXT PRIMARY KEY,
      intent_id TEXT,
      decision_id TEXT,
      exchange TEXT NOT NULL,
      asset TEXT NOT NULL DEFAULT 'USDT',
      from_account TEXT NOT NULL,
      to_account TEXT NOT NULL,
      amount_usdt REAL NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      transfer_id TEXT,
      error TEXT,
      raw_json TEXT,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
  `,
  ORDER_PLAN_LEDGER: `
    CREATE TABLE IF NOT EXISTS order_plan_ledger (
      id TEXT PRIMARY KEY,
      intent_id TEXT,
      decision_id TEXT,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      planned_notional_usdt REAL NOT NULL,
      status TEXT NOT NULL,
      allowed_for_actual_order INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_plan_ledger_intent_id ON order_plan_ledger(intent_id);
    CREATE INDEX IF NOT EXISTS idx_order_plan_ledger_status ON order_plan_ledger(status);
  `,
  ORDER_EXECUTION_LEDGER: `
    CREATE TABLE IF NOT EXISTS order_execution_ledger (
      id TEXT PRIMARY KEY,
      order_plan_id TEXT NOT NULL,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      spot_client_order_id TEXT,
      spot_exchange_order_id TEXT,
      spot_status TEXT,
      perp_client_order_id TEXT,
      perp_exchange_order_id TEXT,
      perp_status TEXT,
      frozen_reason TEXT,
      raw_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_execution_ledger_order_plan_id ON order_execution_ledger(order_plan_id);
    CREATE INDEX IF NOT EXISTS idx_order_execution_ledger_status ON order_execution_ledger(status);
  `,
  CLOSE_PLAN_LEDGER: `
    CREATE TABLE IF NOT EXISTS close_plan_ledger (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      spot_close_qty REAL NOT NULL DEFAULT 0,
      perp_close_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      blockers_json TEXT DEFAULT '[]',
      warnings_json TEXT DEFAULT '[]',
      real_close_enabled INTEGER DEFAULT 0,
      raw_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      expires_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_close_plan_ledger_position_id ON close_plan_ledger(position_id);
    CREATE INDEX IF NOT EXISTS idx_close_plan_ledger_status ON close_plan_ledger(status);
  `,
  CLOSE_EXECUTION_LEDGER: `
    CREATE TABLE IF NOT EXISTS close_execution_ledger (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      close_plan_id TEXT NOT NULL,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      perp_client_order_id TEXT,
      perp_exchange_order_id TEXT,
      perp_status TEXT,
      spot_client_order_id TEXT,
      spot_exchange_order_id TEXT,
      spot_status TEXT,
      frozen_reason TEXT,
      final_pnl_json TEXT,
      verification_json TEXT,
      raw_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_close_execution_ledger_position_id ON close_execution_ledger(position_id);
    CREATE INDEX IF NOT EXISTS idx_close_execution_ledger_status ON close_execution_ledger(status);
  `,
  // P3：用户绑定的交易所 API 账户。仅存加密后的密钥 + 脱敏展示字段，明文永不落库。
  EXCHANGE_ACCOUNTS: `
    CREATE TABLE IF NOT EXISTS exchange_accounts (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      label TEXT NOT NULL,
      masked_api_key TEXT NOT NULL,
      encrypted_api_key_json TEXT NOT NULL,
      encrypted_secret_json TEXT NOT NULL,
      encrypted_passphrase_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_accounts_exchange ON exchange_accounts(exchange);
    CREATE INDEX IF NOT EXISTS idx_exchange_accounts_enabled ON exchange_accounts(enabled);
  `,
  // P3：每个账户一行权限能力（探测结果）。主键 account_id，upsert 覆盖。
  EXCHANGE_CAPABILITIES: `
    CREATE TABLE IF NOT EXISTS exchange_capabilities (
      account_id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      read_balance INTEGER NOT NULL DEFAULT 0,
      read_spot INTEGER NOT NULL DEFAULT 0,
      read_perp INTEGER NOT NULL DEFAULT 0,
      trade_spot INTEGER NOT NULL DEFAULT 0,
      trade_perp INTEGER NOT NULL DEFAULT 0,
      internal_transfer INTEGER NOT NULL DEFAULT 0,
      funding_rate INTEGER NOT NULL DEFAULT 0,
      positions INTEGER NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      same_exchange_arb_enabled INTEGER NOT NULL DEFAULT 0,
      cross_exchange_arb_enabled INTEGER NOT NULL DEFAULT 0,
      last_checked_at_utc TEXT,
      last_error TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_capabilities_exchange ON exchange_capabilities(exchange);
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
  "user_strategy_settings", "internal_transfer_ledger",
  "order_plan_ledger", "order_execution_ledger",
  "close_plan_ledger", "close_execution_ledger",
  "exchange_accounts", "exchange_capabilities",
];