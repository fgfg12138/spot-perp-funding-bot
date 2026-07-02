/**
 * Persistence Repository Interface
 *
 * All v121 persistence implementations (JSONL, SQLite, PostgreSQL)
 * must implement this interface for clean swap-ability.
 */

export interface IPersistenceRepository {
  save(table: string, record: Record<string, unknown>): void;
  saveAll(table: string, records: Record<string, unknown>[]): void;
  queryAll(table: string): Record<string, unknown>[];
  query(table: string, filter: (r: Record<string, unknown>) => boolean): Record<string, unknown>[];
  latest(table: string): Record<string, unknown> | undefined;
  count(table: string): number;
  clear(table: string): void;
  /** Delete a single record by primary key (column name "id"). No-op if missing. */
  deleteById(table: string, id: string): void;
  listTables(): string[];
}

export const CORE_TABLES = [
  "opportunity_records",
  "entry_decisions",
  "entry_executions",
  "position_snapshots",
  "funding_settlements",
  "exit_executions",
  "final_reviews",
] as const;

export type CoreTable = (typeof CORE_TABLES)[number];
