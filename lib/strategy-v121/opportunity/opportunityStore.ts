/**
 * 最新扫描结果缓存 — 避免 GET 每次触发交易所 API。
 *
 * ⚠️ DEV-ONLY: JSONL 持久化，不适用于 MAINNET_TINY。
 */
import { getRepository } from "../persistence/repositoryFactory";

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
  } as any);
}

export function getLatestScan(): LatestScan | null {
  const all = repo().queryAll("latest_scan");
  if (all.length === 0) return null;
  const row = all[all.length - 1] as any;
  let opps: any[] = [];
  const raw = row.opportunities_json ?? row.opportunities ?? "[]";
  if (Array.isArray(raw)) {
    opps = raw;
  } else if (typeof raw === "string") {
    try { opps = JSON.parse(raw); } catch {}
  }
  return {
    opportunities: opps,
    totalPaths: row.totalPaths ?? row.total_paths ?? row.totalPaths ?? 0,
    passedCount: row.passedCount ?? row.passed_count ?? row.passedCount ?? 0,
    rejectedCount: row.rejectedCount ?? row.rejected_count ?? row.rejectedCount ?? 0,
    rejectSummary: safeParse(row.rejectSummary ?? row.reject_summary_json ?? row.rejectSummaryJson, {}),
    errors: safeParse(row.errors ?? row.errors_json ?? row.errorsJson, []),
    dataSource: row.dataSource ?? row.data_source ?? row.dataSource ?? "no_data",
    scannedAtUtc: row.scannedAtUtc ?? row.scanned_at_utc ?? row.scannedAtUtc ?? 0,
    durationMs: row.durationMs ?? row.duration_ms ?? row.durationMs ?? 0,
    symbolsScanned: 5,
    exchangesScanned: 3,
  };
}

function safeParse(v: any, fallback: any): any {
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  if (v !== undefined && v !== null) return v;
  return fallback;
}

export function clearLatestScan(): void {
  repo().clear("latest_scan");
}
