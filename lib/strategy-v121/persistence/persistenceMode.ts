/**
 * 持久化模式 — 控制 JSONL / SQLite 切换。
 *
 * jsonl-dev-only:   开发用 JSONL，不允许 MAINNET_TINY 实际执行
 * sqlite-ready:     SQLite 已就绪，等待激活
 * sqlite-active:    SQLite 已激活，允许 MAINNET_TINY 实际执行
 */
export type PersistenceMode = "jsonl-dev-only" | "sqlite-ready" | "sqlite-active";

let currentMode: PersistenceMode = "jsonl-dev-only";

export function getPersistenceMode(): PersistenceMode {
  return currentMode;
}

export function setPersistenceMode(mode: PersistenceMode): void {
  currentMode = mode;
}

export function isPersistenceReadyForTiny(): boolean {
  return currentMode === "sqlite-active";
}
