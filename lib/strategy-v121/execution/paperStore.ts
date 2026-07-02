import type { PaperExecution } from "./paperLifecycle";
import { BasePersistence } from "../persistence/basePersistence";

/**
 * Paper execution store — JSONL/SQLite 持久化。
 *
 * ⚠️ DEV-ONLY 当 persistence=jsonl-dev-only。
 * TODO: 正式用于 MAINNET_TINY 需 sqlite-active。
 */

export class PaperExecutionStore extends BasePersistence<PaperExecution> {
  constructor() {
    super("paper_executions", undefined, true); // useCache=true
  }

  /**
   * PaperExecution 的特殊需求：每次 save 后全量 flush（覆盖整个表），
   * 而非基类默认的单条 deleteById + save。
   */
  save(record: PaperExecution): void {
    this.cache.set(record.id, { ...record });
    this.flushToDisk();
  }
}

export const paperStore = new PaperExecutionStore();
