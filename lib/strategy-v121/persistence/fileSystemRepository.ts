/**
 * FileSystemRepository — JSONL-based development persistence.
 *
 * ⚠️ DEV-ONLY: This is not production-grade persistence.
 * TODO: Replace with better-sqlite3 or PostgreSQL via
 *       the IPersistenceRepository interface in repositoryTypes.ts
 *       before entering MAINNET_TINY phase.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IPersistenceRepository } from "./repositoryTypes";

export class FileSystemRepository implements IPersistenceRepository {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  /** Append a record to a table (JSONL file). */
  save(table: string, record: Record<string, unknown>): void {
    const filePath = path.join(this.basePath, `${table}.jsonl`);
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
  }

  /** Save multiple records at once. */
  saveAll(table: string, records: Record<string, unknown>[]): void {
    for (const rec of records) {
      this.save(table, rec);
    }
  }

  /** Read all records from a table. */
  queryAll(table: string): Record<string, unknown>[] {
    const filePath = path.join(this.basePath, `${table}.jsonl`);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map(line => JSON.parse(line));
  }

  /** Query records matching a filter function. */
  query(table: string, filter: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    return this.queryAll(table).filter(filter);
  }

  /** Get the latest record from a table. */
  latest(table: string): Record<string, unknown> | undefined {
    const all = this.queryAll(table);
    return all.length > 0 ? all[all.length - 1] : undefined;
  }

  /** Count records in a table. */
  count(table: string): number {
    return this.queryAll(table).length;
  }

  /** Clear a table. */
  clear(table: string): void {
    const filePath = path.join(this.basePath, `${table}.jsonl`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** Delete a single record by primary key (column name "id"). No-op if missing. */
  deleteById(table: string, id: string): void {
    const filePath = path.join(this.basePath, `${table}.jsonl`);
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
    const kept = lines.filter(line => {
      try {
        const rec = JSON.parse(line);
        return rec.id !== id;
      } catch {
        return true; // 无法解析的行保留
      }
    });
    fs.writeFileSync(filePath, kept.length > 0 ? kept.join("\n") + "\n" : "", "utf-8");
  }

  /** List all table names (based on existing files). */
  listTables(): string[] {
    if (!fs.existsSync(this.basePath)) return [];
    return fs.readdirSync(this.basePath)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => f.replace(".jsonl", ""));
  }
}
