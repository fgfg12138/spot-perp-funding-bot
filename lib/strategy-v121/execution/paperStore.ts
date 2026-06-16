import type { PaperExecution } from "./paperLifecycle";

/**
 * In-memory store for Paper executions.
 *
 * ⚠️ DEV: This store is reset on process restart.
 * TODO: Migrate to persistent storage (SQLite) before MAINNET_TINY.
 */
export class PaperExecutionStore {
  private store = new Map<string, PaperExecution>();

  save(ex: PaperExecution): void {
    this.store.set(ex.id, { ...ex });
  }

  findById(id: string): PaperExecution | undefined {
    const ex = this.store.get(id);
    return ex ? { ...ex } : undefined;
  }

  findAll(): PaperExecution[] {
    return Array.from(this.store.values()).map(e => ({ ...e }));
  }

  delete(id: string): void {
    this.store.delete(id);
  }
}

export const paperStore = new PaperExecutionStore();
