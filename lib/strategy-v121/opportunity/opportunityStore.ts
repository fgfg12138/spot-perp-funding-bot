/**
 * 最新扫描结果缓存 — 避免 GET 每次触发交易所 API。
 *
 * ⚠️ DEV-ONLY: JSONL 持久化，不适用于 MAINNET_TINY。
 */
import { getRepository } from "../persistence/repositoryFactory";
import {
  type LatestScanRow,
  readJson,
  readNumber,
  readString,
  readTimestamp,
} from "../persistence/repositoryRowTypes";

function repo() { return getRepository(); }

export interface LatestScan {
  opportunities: any[];
  totalPaths: number;
  passedCount: number;
  rejectedCount: number;
  rejectSummary: Record<string, number>;
  errors: any[];
  dataSource: string;
  scannedAtUtc: number;
  durationMs: number;
  symbolsScanned: number;
  exchangesScanned: number;
}

export function saveLatestScan(scan: LatestScan): void {
  repo().clear("latest_scan");
  repo().save("latest_scan", {
    id: `scan-${scan.scannedAtUtc}`,
    total_paths: scan.totalPaths,
    passed_count: scan.passedCount,
    rejected_count: scan.rejectedCount,
    data_source: scan.dataSource,
    scanned_at_utc: scan.scannedAtUtc,
    duration_ms: scan.durationMs,
    errors_json: JSON.stringify(scan.errors),
    reject_summary_json: JSON.stringify(scan.rejectSummary),
    opportunities_json: JSON.stringify(scan.opportunities ?? []),
  });
}

export function getLatestScan(): LatestScan | null {
  const all = repo().queryAll("latest_scan") as unknown as LatestScanRow[];
  if (all.length === 0) return null;
  const row = all[all.length - 1];
  return {
    opportunities: readJson<unknown[]>(row, ["opportunities_json", "opportunities"], []),
    totalPaths: readNumber(row, ["total_paths", "totalPaths"], 0),
    passedCount: readNumber(row, ["passed_count", "passedCount"], 0),
    rejectedCount: readNumber(row, ["rejected_count", "rejectedCount"], 0),
    rejectSummary: readJson<Record<string, number>>(row, ["reject_summary_json", "rejectSummary", "rejectSummaryJson"], {}),
    errors: readJson<unknown[]>(row, ["errors_json", "errors", "errorsJson"], []),
    dataSource: readString(row, ["data_source", "dataSource"], "no_data"),
    scannedAtUtc: readTimestamp(row, ["scanned_at_utc", "scannedAtUtc"]),
    durationMs: readNumber(row, ["duration_ms", "durationMs"], 0),
    symbolsScanned: 5,
    exchangesScanned: 3,
  };
}

export function clearLatestScan(): void {
  repo().clear("latest_scan");
}
