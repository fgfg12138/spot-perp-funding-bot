/**
 * 最新扫描结果缓存 — 避免 GET 每次触发交易所 API。
 *
 * ⚠️ DEV-ONLY: JSONL 持久化，不适用于 MAINNET_TINY。
 */
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import { getRepository } from "../persistence/repositoryFactory";
import * as path from "node:path";

const repo = getRepository();

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
  repo.clear("latest_scan");
  repo.save("latest_scan", scan as any);
}

export function getLatestScan(): LatestScan | null {
  const all = repo.queryAll("latest_scan");
  return all.length > 0 ? (all[all.length - 1] as any) : null;
}

export function clearLatestScan(): void {
  repo.clear("latest_scan");
}
