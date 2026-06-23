/**
 * SQLite Repository — 生产级持久化（better-sqlite3）。
 *
 * 不存储 API Key / Secret / Passphrase。
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { getAllCreateTableSQL } from "./schema";
import { getExtraCreateSQL, ALL_TABLE_NAMES } from "./sqliteSchema";

export class SqliteRepository {
  private db: any;

  constructor(dbPath?: string) {
    const Database = require("better-sqlite3");
    const resolvedPath = dbPath ?? process.env.V121_SQLITE_PATH ?? ".v121-data/v121.sqlite";
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    for (const sql of getAllCreateTableSQL()) {
      this.db.exec(sql);
    }
    for (const sql of getExtraCreateSQL()) {
      this.db.exec(sql);
    }
    // 兼容旧数据库：补加缺失列
    this.migrate();
  }

  private migrate(): void {
    const patches: Record<string, string[]> = {
      latest_scan: ["opportunities_json TEXT DEFAULT '[]'"],
      order_intents: [
        "intentId TEXT",
        "mode TEXT",
        "symbol TEXT",
        "spotExchange TEXT",
        "perpExchange TEXT",
        "side TEXT DEFAULT 'buy_spot_short_perp'",
        "plannedNotionalUsdt REAL",
        "batchNo INTEGER DEFAULT 1",
        "reason TEXT",
        "createdAtUtc INTEGER",
        "gateAllowed INTEGER DEFAULT 0",
        "blockedReasons TEXT DEFAULT '[]'",
        "requiresManualConfirm INTEGER DEFAULT 1",
        "manualConfirmPassed INTEGER DEFAULT 0",
        "dryRun INTEGER DEFAULT 1",
        "realOrderExecutionEnabled INTEGER DEFAULT 0",
        "purpose TEXT DEFAULT 'real_arbitrage'",
        "simulationOnly INTEGER DEFAULT 0",
        "realTradeEligible INTEGER DEFAULT 0",
        "dataSource TEXT DEFAULT 'order_intent'",
      ],
      user_strategy_settings: [
        "json TEXT",
        "settings_json TEXT",
        "created_at_utc INTEGER",
        "updated_at_utc INTEGER",
      ],
      worker_heartbeat: [
        "worker_id TEXT",
        "state TEXT DEFAULT 'stopped'",
        "mode TEXT",
        "last_cycle_at_utc INTEGER",
        "cycle_count INTEGER DEFAULT 0",
        "last_error TEXT",
      ],
    };
    for (const [table, columns] of Object.entries(patches)) {
      for (const col of columns) {
        const colName = col.split(" ")[0];
        try { this.db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col}`); } catch {}
      }
    }
  }

  save(table: string, record: Record<string, unknown>): void {
    const keys = Object.keys(record);
    const cols = keys.map(k => `"${k}"`).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${placeholders})`;
    this.db.prepare(sql).run(...keys.map(k => {
      const v = record[k];
      if (v === null || v === undefined) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    }));
  }

  saveAll(table: string, records: Record<string, unknown>[]): void {
    const tx = this.db.transaction(() => {
      for (const r of records) this.save(table, r);
    });
    tx();
  }

  queryAll(table: string): Record<string, unknown>[] {
    try {
      const rows = this.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[];
      return rows.map(row => {
        const result: Record<string, unknown> = {};
        const boolCols = new Set([
          "gateAllowed","requiresManualConfirm","manualConfirmPassed","dryRun","realOrderExecutionEnabled","simulationOnly","realTradeEligible","passed","allowHtx","allowSmallCaps","allowCrossExchange","requireManualConfirm","allowAutoEntry","allowRiskExit","immutable","isTestThreshold",
          // exchange_accounts / exchange_capabilities 布尔列
          "enabled",
          "read_balance","read_spot","read_perp",
          "trade_spot","trade_perp","internal_transfer","funding_rate",
          "positions","orders",
          "same_exchange_arb_enabled","cross_exchange_arb_enabled",
        ]);
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
            try { result[k] = JSON.parse(v); } catch { result[k] = v; }
          } else if (typeof v === "number" && (v === 0 || v === 1) && boolCols.has(k)) {
            result[k] = v === 1;
          } else {
            result[k] = v;
          }
        }
        return result;
      });
    } catch { return []; }
  }

  query(table: string, filter: (r: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    return this.queryAll(table).filter(filter);
  }

  latest(table: string): Record<string, unknown> | undefined {
    const rows = this.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT 1`).all();
    return rows.length > 0 ? rows[0] as Record<string, unknown> : undefined;
  }

  count(table: string): number {
    try {
      const row = this.db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as any;
      return row?.c ?? 0;
    } catch { return 0; }
  }

  clear(table: string): void {
    try { this.db.exec(`DELETE FROM "${table}"`); } catch { /* ignore */ }
  }

  deleteById(table: string, id: string): void {
    try { this.db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id); } catch { /* ignore */ }
  }

  listTables(): string[] {
    return ALL_TABLE_NAMES;
  }

  close(): void {
    this.db.close();
  }

  healthCheck(): boolean {
    try { this.db.exec("SELECT 1"); return true; } catch { return false; }
  }
}
