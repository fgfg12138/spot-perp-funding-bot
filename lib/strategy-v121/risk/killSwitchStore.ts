/**
 * Kill Switch 持久化存储
 *
 * 使用统一的 repository 将 Kill Switch 状态持久化到 JSONL/SQLite。
 * 数据存储在 .v121-data/kill_switch.jsonl。
 *
 * ⚠️ 数据迁移：旧数据在 .v121-data/kill-switch.json（独立文件），
 *    新数据在 .v121-data/kill_switch.jsonl。
 *    首次部署时需将旧文件内容手动迁移到新 JSONL 中。
 */

import { BasePersistence } from "../persistence/basePersistence";
import type { KillSwitchState } from "./killSwitch";

export interface KillSwitchRow {
  id: string;
  state: string;
  updatedAt: number;
}

export class KillSwitchStore extends BasePersistence<KillSwitchRow> {
  constructor() {
    super("kill_switch", undefined, true); // useCache=true
  }

  static load(): KillSwitchState {
    try {
      const store = new KillSwitchStore();
      const row = store.findById("default");
      if (row && isValidState(row.state)) return row.state as KillSwitchState;
    } catch {
      // ignore
    }
    return "OFF";
  }

  static save(state: KillSwitchState): void {
    const store = new KillSwitchStore();
    store.save({ id: "default", state, updatedAt: Date.now() });
  }
}

function isValidState(s: string): s is KillSwitchState {
  return ["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"].includes(s);
}
