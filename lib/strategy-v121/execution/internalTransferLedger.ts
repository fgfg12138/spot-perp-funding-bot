import type { InternalTransferLedgerRecord } from "./internalTransferTypes";
import { BaseLedgerStore } from "../persistence/baseLedgerStore";

export class InternalTransferLedgerStore extends BaseLedgerStore<InternalTransferLedgerRecord> {
  constructor() {
    super("internal_transfer_ledger");
  }

  updateRecord(id: string, patch: Partial<InternalTransferLedgerRecord>): void {
    const existing = this.findById(id);
    if (!existing) return;
    this.save({
      ...existing,
      ...patch,
      updatedAtUtc: new Date().toISOString(),
    });
  }

  findByIdempotencyKey(key: string): InternalTransferLedgerRecord | undefined {
    return this.findByField("idempotencyKey", key);
  }
}

// 导出单例
export const internalTransferLedgerStore = new InternalTransferLedgerStore();

// ─── 兼容旧 API 的函数包装 ──────────────────────────

export function createInternalTransferRecord(record: InternalTransferLedgerRecord): void {
  internalTransferLedgerStore.save(record);
}

export function updateInternalTransferRecord(id: string, patch: Partial<InternalTransferLedgerRecord>): void {
  internalTransferLedgerStore.updateRecord(id, patch);
}

export function findInternalTransferById(id: string): InternalTransferLedgerRecord | null {
  return internalTransferLedgerStore.findById(id) ?? null;
}

export function findInternalTransferByIdempotencyKey(key: string): InternalTransferLedgerRecord | null {
  return internalTransferLedgerStore.findByIdempotencyKey(key) ?? null;
}

export function listRecentInternalTransfers(limit = 20): InternalTransferLedgerRecord[] {
  return internalTransferLedgerStore.listRecent(limit);
}
