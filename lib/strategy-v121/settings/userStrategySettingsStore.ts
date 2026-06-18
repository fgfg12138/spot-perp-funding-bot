import { getRepository } from "../persistence/repositoryFactory";
import {
  DEFAULT_USER_STRATEGY_SETTINGS,
  normalizeSettings,
  validateSettings,
  type UserStrategySettings,
} from "./userStrategySettings";

const SETTINGS_KEY = "default";

export async function loadSettings(): Promise<UserStrategySettings> {
  const repo = getRepository();
  const rows = repo.queryAll("user_strategy_settings") as any[];
  const row = rows.find((r: any) => r.id === SETTINGS_KEY);
  if (!row || !row.json) return { ...DEFAULT_USER_STRATEGY_SETTINGS };
  try {
    const parsed = JSON.parse(String(row.json));
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_USER_STRATEGY_SETTINGS };
  }
}

export async function saveSettingsPatch(patch: unknown): Promise<{
  settings: UserStrategySettings;
  warnings: string[];
}> {
  const current = await loadSettings();
  const merged = normalizeSettings(mergeDeep(current, patch));
  const warnings = validateSettings(merged);
  const repo = getRepository();
  repo.save("user_strategy_settings", {
    id: SETTINGS_KEY,
    json: JSON.stringify(merged),
    created_at_utc: Date.now(),
    updated_at_utc: Date.now(),
  } as any);
  return { settings: merged, warnings };
}

function mergeDeep(target: any, patch: any): any {
  if (!patch || typeof patch !== "object") return target;
  const result = { ...target };
  for (const key of Object.keys(patch)) {
    if (key === "version") continue;
    if (typeof patch[key] === "object" && patch[key] !== null && !Array.isArray(patch[key])) {
      result[key] = mergeDeep(result[key] ?? {}, patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}
