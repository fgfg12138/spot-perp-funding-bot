/**
 * Repository 工厂 — 根据 V121_PERSISTENCE_MODE 选择 JSONL / SQLite。
 */
import { FileSystemRepository } from "./fileSystemRepository";
import { SqliteRepository } from "./sqliteRepository";
import { getPersistenceMode, setPersistenceMode, isPersistenceMode } from "./persistenceMode";
import { getPersistenceModeFromConfig } from "../config/runtimeConfig";
import * as path from "node:path";

let jsonlRepo: FileSystemRepository | null = null;
let sqliteRepo: SqliteRepository | null = null;

export function getRepository(): FileSystemRepository | SqliteRepository {
  const mode = getPersistenceMode();

  if (mode === "sqlite-active" || mode === "sqlite-ready") {
    if (!sqliteRepo) {
      try {
        sqliteRepo = new SqliteRepository();
      } catch (err) {
        console.error("SQLite 初始化失败，回退到 JSONL:", err);
        setPersistenceMode("jsonl-dev-only");
        return getJsonlRepo();
      }
    }
    return sqliteRepo;
  }

  return getJsonlRepo();
}

function getJsonlRepo(): FileSystemRepository {
  if (!jsonlRepo) {
    jsonlRepo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));
  }
  return jsonlRepo;
}

export function initPersistence(mode?: string): void {
  const m = mode ?? getPersistenceModeFromConfig() ?? "jsonl-dev-only";
  if (isPersistenceMode(m)) {
    setPersistenceMode(m);
  }
  getRepository();
}
