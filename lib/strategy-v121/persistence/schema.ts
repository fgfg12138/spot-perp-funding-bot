export const TABLES = {
  OPPORTUNITY_RECORDS: "opportunity_records",
  ENTRY_DECISIONS: "entry_decisions",
  ENTRY_EXECUTIONS: "entry_executions",
  POSITION_SNAPSHOTS: "position_snapshots",
  FUNDING_SETTLEMENTS: "funding_settlements",
  EXIT_EXECUTIONS: "exit_executions",
  FINAL_REVIEWS: "final_reviews",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

export const CREATE_TABLE_SQL: Record<TableName, string> = {
  [TABLES.OPPORTUNITY_RECORDS]: `
    CREATE TABLE IF NOT EXISTS opportunity_records (
      id TEXT PRIMARY KEY,
      discovered_at_utc INTEGER NOT NULL,
      discovered_at_utc8 TEXT NOT NULL,
      symbol TEXT NOT NULL,
      spot_exchange TEXT NOT NULL,
      perp_exchange TEXT NOT NULL,
      funding_8h REAL NOT NULL,
      entry_basis REAL NOT NULL,
      exit_basis REAL,
      spot_depth REAL,
      perp_depth REAL,
      score INTEGER,
      level TEXT,
      passed INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT,
      raw_snapshot_json TEXT
    );
  `,

  [TABLES.ENTRY_DECISIONS]: `
    CREATE TABLE IF NOT EXISTS entry_decisions (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      planned_position REAL NOT NULL,
      expected_basis REAL NOT NULL,
      expected_funding REAL NOT NULL,
      expected_fees REAL NOT NULL,
      expected_slippage REAL NOT NULL,
      risk_discount REAL NOT NULL DEFAULT 0,
      expected_net_profit REAL NOT NULL,
      expected_net_rate REAL NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      decision_reason TEXT,
      FOREIGN KEY (opportunity_id) REFERENCES opportunity_records(id)
    );
  `,

  [TABLES.ENTRY_EXECUTIONS]: `
    CREATE TABLE IF NOT EXISTS entry_executions (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      batch_no INTEGER NOT NULL,
      planned_ratio REAL NOT NULL,
      cumulative_target REAL NOT NULL,
      spot_order_price REAL,
      perp_order_price REAL,
      spot_avg_price REAL,
      perp_avg_price REAL,
      spot_qty REAL,
      perp_qty REAL,
      actual_basis REAL,
      fee REAL,
      slippage REAL,
      position_deviation REAL,
      short_leg_action TEXT,
      execution_state TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (decision_id) REFERENCES entry_decisions(id)
    );
  `,

  [TABLES.POSITION_SNAPSHOTS]: `
    CREATE TABLE IF NOT EXISTS position_snapshots (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      timestamp_utc INTEGER NOT NULL,
      timestamp_utc8 TEXT NOT NULL,
      current_basis REAL,
      mark_price REAL,
      funding REAL,
      realized_funding REAL,
      margin_ratio REAL,
      adl_level TEXT,
      depth REAL,
      risk_reason TEXT,
      health_state TEXT
    );
  `,

  [TABLES.FUNDING_SETTLEMENTS]: `
    CREATE TABLE IF NOT EXISTS funding_settlements (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      funding_time_utc INTEGER NOT NULL,
      funding_time_utc8 TEXT NOT NULL,
      predicted_funding REAL,
      actual_funding REAL,
      notional REAL,
      received REAL,
      realization_rate REAL
    );
  `,

  [TABLES.EXIT_EXECUTIONS]: `
    CREATE TABLE IF NOT EXISTS exit_executions (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      close_reason TEXT NOT NULL,
      spot_exit_avg REAL,
      perp_exit_avg REAL,
      close_basis REAL,
      fee REAL,
      slippage REAL,
      short_leg INTEGER DEFAULT 0,
      fully_closed INTEGER DEFAULT 1
    );
  `,

  [TABLES.FINAL_REVIEWS]: `
    CREATE TABLE IF NOT EXISTS final_reviews (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      net_profit REAL,
      basis_profit REAL,
      funding_profit REAL,
      total_cost REAL,
      max_drawdown REAL,
      profit_deviation REAL,
      funding_realization_rate REAL,
      basis_realization_rate REAL,
      slippage_ratio REAL,
      capital_turnover REAL,
      theoretical_apy REAL,
      actual_account_apy REAL,
      deviation_reason TEXT,
      next_optimization TEXT
    );
  `,
};

export function getAllCreateTableSQL(): string[] {
  return Object.values(CREATE_TABLE_SQL);
}

export const INDEX_SQL: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_opportunity_discovered ON opportunity_records(discovered_at_utc);`,
  `CREATE INDEX IF NOT EXISTS idx_entry_decision_opp ON entry_decisions(opportunity_id);`,
  `CREATE INDEX IF NOT EXISTS idx_entry_exec_decision ON entry_executions(decision_id);`,
  `CREATE INDEX IF NOT EXISTS idx_position_snap_pos ON position_snapshots(position_id);`,
  `CREATE INDEX IF NOT EXISTS idx_funding_settle_pos ON funding_settlements(position_id);`,
  `CREATE INDEX IF NOT EXISTS idx_exit_exec_pos ON exit_executions(position_id);`,
  `CREATE INDEX IF NOT EXISTS idx_final_review_pos ON final_reviews(position_id);`,
];
