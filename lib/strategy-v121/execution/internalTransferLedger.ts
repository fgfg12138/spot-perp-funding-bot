import type { InternalTransferLedgerRecord } from "./internalTransferTypes";
import { getRepository } from "../persistence/repositoryFactory";

const T = "internal_transfer_ledger";

export async function createInternalTransferRecord(record: InternalTransferLedgerRecord): Promise<void> {
  const repo = getRepository();
  repo.save(T, record as any);
}

export async function updateInternalTransferRecord(id: string, patch: Partial<InternalTransferLedgerRecord>): Promise<void> {
  const repo = getRepository();
  repo.save(T, { ...repo.queryAll(T).find((r: any) => r.id === id), ...patch, updatedAtUtc: new Date().toISOString() } as any);
}

export async function findInternalTransferById(id: string): Promise<InternalTransferLedgerRecord | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows.find((r: any) => r.id === id) ?? null;
}

export async function findInternalTransferByIdempotencyKey(idempotencyKey: string): Promise<InternalTransferLedgerRecord | null> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows.find((r: any) => r.idempotencyKey === idempotencyKey) ?? null;
}

export async function listRecentInternalTransfers(limit = 20): Promise<InternalTransferLedgerRecord[]> {
  const repo = getRepository();
  const rows = repo.queryAll(T) as any[];
  return rows.sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime()).slice(0, limit);
}
