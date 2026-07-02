/**
 * 持久化模式 — 控制 JSONL / SQLite 切换。
 *
 * jsonl-dev-only:   开发用 JSONL，不允许 MAINNET_TINY 实际执行
 * sqlite-ready:     SQLite 已就绪，等待激活
 * sqlite-active:    SQLite 已激活，允许 MAINNET_TINY 实际执行
 */
import { getPersistenceModeFromConfig } from "../config/runtimeConfig";

export type PersistenceMode = "jsonl-dev-only" | "sqlite-ready" | "sqlite-active";

const PERSISTENCE_MODES: PersistenceMode[] = ["jsonl-dev-only", "sqlite-ready", "sqlite-active"];
export function isPersistenceMode(value: unknown): value is PersistenceMode {
  return typeof value === "string" && PERSISTENCE_MODES.includes(value as PersistenceMode);
}

let currentMode: PersistenceMode = "jsonl-dev-only";
let initialized = false;

export function getPersistenceMode(): PersistenceMode {
  if (!initialized) {
    initialized = true;
    const env = getPersistenceModeFromConfig();
    if (env === "sqlite-active" || env === "sqlite-ready") {
      currentMode = env;
    }
  }
  return currentMode;
}

export function setPersistenceMode(mode: PersistenceMode): void {
  currentMode = mode;
}

export function isPersistenceReadyForTiny(): boolean {
  return currentMode === "sqlite-active";
}
