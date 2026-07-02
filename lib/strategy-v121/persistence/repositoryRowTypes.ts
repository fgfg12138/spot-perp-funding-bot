/**
 * 类型化 persistence 行定义与读取辅助函数。
 *
 * 由于历史数据在 JSONL/SQLite 中混用 snake_case 与 camelCase 字段名，
 * 本文件统一提供兼容两种命名的行接口，以及按优先级读取的 helper。
 */

/** latest_scan 表的一行。 */
export interface LatestScanRow {
  [k: string]: unknown;
  id: string;
  total_paths?: number;
  passed_count?: number;
  rejected_count?: number;
  data_source?: string;
  scanned_at_utc?: number;
  scannedAtUtc?: number;
  opportunities_json?: string;
  opportunities?: unknown[];
  reject_summary_json?: string;
  rejectSummary?: Record<string, number>;
  errors_json?: string;
  errors?: unknown[];
  duration_ms?: number;
  symbols_scanned?: number;
  exchanges_scanned?: number;
}

/** worker_heartbeat 表的一行。 */
export interface WorkerHeartbeatRow {
  [k: string]: unknown;
  id: string;
  worker_id?: string;
  workerId?: string;
  state?: string;
  mode?: string;
  last_cycle_at_utc?: number;
  lastCycleAtUtc?: number;
  cycle_count?: number;
  cycleCount?: number;
  last_error?: string;
  lastError?: string;
}

/** user_strategy_settings 表的一行。 */
export interface UserStrategySettingsRow {
  [k: string]: unknown;
  id: string;
  json?: string;
  settings_json?: string;
  settingsJson?: string;
  value?: string;
  data?: string;
  created_at_utc?: number;
  createdAtUtc?: number;
  updated_at_utc?: number;
  updatedAtUtc?: number;
}

/** opportunity_records / opportunity_alerts 表的一行。 */
export interface OpportunityRecordRow {
  [k: string]: unknown;
  id: string;
  status?: "new" | "acknowledged" | "expired" | "converted_to_intent";
  detected_at_utc?: number;
  detectedAtUtc?: number;
  symbol?: string;
  exchange?: string;
  score?: number;
  data_json?: string;
  data?: Record<string, unknown>;
}

/** order_intents 表的一行。 */
export interface OrderIntentRow {
  [k: string]: unknown;
  id: string;
  intentId?: string;
  mode?: string;
  symbol?: string;
  spotExchange?: string;
  perpExchange?: string;
  side?: string;
  plannedNotionalUsdt?: number;
  batchNo?: number;
  reason?: string;
  createdAtUtc?: number;
  gateAllowed?: boolean;
  blockedReasons?: string;
  requiresManualConfirm?: boolean;
  manualConfirmPassed?: boolean;
  dryRun?: boolean;
  realOrderExecutionEnabled?: boolean;
  purpose?: string;
  simulationOnly?: boolean;
  realTradeEligible?: boolean;
  dataSource?: string;
}

/**
 * 按优先级从行中读取第一个可用的时间戳字段。
 * 解析失败或全部缺失时返回 0。
 */
export function readTimestamp(row: { [k: string]: unknown }, keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * 按优先级从行中读取第一个可用字符串字段。
 * 全部缺失时返回 fallback。
 */
export function readString(
  row: { [k: string]: unknown },
  keys: string[],
  fallback = "",
): string {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    return String(v);
  }
  return fallback;
}

/**
 * 按优先级从行中读取第一个可用数字字段。
 * 解析失败或全部缺失时返回 fallback。
 */
export function readNumber(
  row: { [k: string]: unknown },
  keys: string[],
  fallback = 0,
): number {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * 按优先级从行中读取第一个可用布尔字段。
 * 支持 boolean / number(1/0) / string("true"/"1")。
 * 全部缺失时返回 fallback。
 */
export function readBoolean(
  row: { [k: string]: unknown },
  keys: string[],
  fallback = false,
): boolean {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") return v === "true" || v === "1";
  }
  return fallback;
}

/**
 * 按优先级从行中读取并解析 JSON 字段。
 * 支持字符串（自动 JSON.parse）或对象（直接返回）。
 * 全部缺失或解析失败时返回 fallback。
 */
export function readJson<T>(
  row: { [k: string]: unknown },
  keys: string[],
  fallback: T,
): T {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as T;
      } catch {
        return fallback;
      }
    }
    if (typeof v === "object") return v as T;
  }
  return fallback;
}
