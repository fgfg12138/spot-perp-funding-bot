import type { PaperExecution } from "./paperLifecycle";
import { getRepository } from "../persistence/repositoryFactory";

/**
 * Paper execution store — JSONL/SQLite 持久化。
 *
 * ⚠️ DEV-ONLY 当 persistence=jsonl-dev-only。
 * TODO: 正式用于 MAINNET_TINY 需 sqlite-active。
 */
function repo() { return getRepository(); }

export class PaperExecutionStore {
  private cache = new Map<string, PaperExecution>();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const records = repo().queryAll("paper_executions") as any[];
      for (const r of records) {
        if (r.id) this.cache.set(r.id, r as PaperExecution);
      }
    } catch { /* ignore load errors */ }
  }

  private flushToDisk(): void {
    repo().clear("paper_executions");
    for (const ex of this.cache.values()) {
      repo().save("paper_executions", ex as any);
    }
  }

  save(ex: PaperExecution): void {
    this.cache.set(ex.id, { ...ex });
    this.flushToDisk();
  }

  findById(id: string): PaperExecution | undefined {
    const ex = this.cache.get(id);
    return ex ? { ...ex } : undefined;
  }

  findAll(): PaperExecution[] {
    return Array.from(this.cache.values()).map(e => ({ ...e }));
  }

  delete(id: string): void {
    this.cache.delete(id);
    this.flushToDisk();
  }
}

export const paperStore = new PaperExecutionStore();
