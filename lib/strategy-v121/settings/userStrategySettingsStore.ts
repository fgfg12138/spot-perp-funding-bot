import { getRepository } from "../persistence/repositoryFactory";
import type { UserStrategySettingsRow } from "../persistence/repositoryRowTypes";
import {
  DEFAULT_USER_STRATEGY_SETTINGS,
  normalizeSettings,
  validateSettings,
  type UserStrategySettings,
} from "./userStrategySettings";

const SETTINGS_KEY = "default";

export async function loadSettings(): Promise<UserStrategySettings> {
  const repo = getRepository();
  const rows = repo.queryAll("user_strategy_settings") as unknown as UserStrategySettingsRow[];
  const row = rows.find((r) => r.id === SETTINGS_KEY);

  const raw =
    row?.json ??
    row?.settings_json ??
    row?.settingsJson ??
    row?.value ??
    row?.data;

  if (!raw) return { ...DEFAULT_USER_STRATEGY_SETTINGS };

  try {
    if (typeof raw === "object") {
      return normalizeSettings(raw);
    }
    return normalizeSettings(JSON.parse(String(raw)));
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
  const now = Date.now();
  const repo = getRepository();

  const existing = repo.queryAll("user_strategy_settings") as unknown as UserStrategySettingsRow[];
  const row = existing.find((r) => r.id === SETTINGS_KEY);
  const json = JSON.stringify(merged);

  // 先删除旧记录，再写入新记录（FileSystemRepository 是 append-only，不删除会导致多条重复记录）
  if (existing.some((r) => r.id === SETTINGS_KEY)) {
    repo.deleteById("user_strategy_settings", SETTINGS_KEY);
  }

  repo.save("user_strategy_settings", {
    id: SETTINGS_KEY,
    json,
    settings_json: json,
    created_at_utc: row?.created_at_utc ?? row?.createdAtUtc ?? now,
    updated_at_utc: now,
  });

  return { settings: merged, warnings };
}

function mergeDeep(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object") return target;
  const result = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(patch as Record<string, unknown>)) {
    if (key === "version") continue;
    const patchValue = (patch as Record<string, unknown>)[key];
    if (typeof patchValue === "object" && patchValue !== null && !Array.isArray(patchValue)) {
      result[key] = mergeDeep(result[key] ?? {}, patchValue);
    } else {
      result[key] = patchValue;
    }
  }
  return result;
}
