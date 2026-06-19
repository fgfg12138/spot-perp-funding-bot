import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeAutoTransferAndReaudit } from "./autoTransferExecutor";

const mockTransferInternal = vi.hoisted(() => vi.fn());
const mockFetchBalances = vi.hoisted(() => vi.fn().mockResolvedValue([
  { asset: "USDT", free: 100, locked: 0, total: 100, exchange: "binance", fetchedAtUtc: "2025-01-01T00:00:00Z" },
]));

vi.mock("./internalTransferLedger", () => ({
  createInternalTransferRecord: vi.fn(),
  updateInternalTransferRecord: vi.fn(),
  findInternalTransferByIdempotencyKey: vi.fn().mockResolvedValue(null),
  listRecentInternalTransfers: vi.fn().mockResolvedValue([]),
}));

vi.mock("../settings/userStrategySettingsStore", () => ({
  loadSettings: vi.fn().mockResolvedValue({
    transfer: { allowAutoTransfer: true, mode: "auto_transfer", maxAutoTransferUsdt: 50 },
    notional: { plannedNotionalUsdt: 10 },
    execution: {},
  }),
}));

vi.mock("../account/adapters/accountAdapterFactory", () => ({
  createAccountAdapter: vi.fn().mockResolvedValue({
    exchangeId: "binance",
    fetchBalances: mockFetchBalances,
    transferInternal: mockTransferInternal,
  }),
}));

const baseInput = {
  intentId: "test-intent",
  transferPlan: {
    exchange: "binance" as const,
    asset: "USDT" as const,
    fromAccount: "spot" as const,
    toAccount: "perp" as const,
    amountUsdt: 20,
    reason: "test",
  },
};

describe("executeAutoTransferAndReaudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. dryRun=true does NOT call adapter.transferInternal", async () => {
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("dry_run");
    expect(mockTransferInternal).not.toHaveBeenCalled();
  });

  it("2. transfer.mode=disabled → blocked", async () => {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    (loadSettings as any).mockResolvedValueOnce({
      transfer: { allowAutoTransfer: true, mode: "disabled", maxAutoTransferUsdt: 50 },
    });
    const r = await executeAutoTransferAndReaudit(baseInput);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.blockers[0]).toContain("disabled");
  });

  it("3. transfer.mode=suggest_only → blocked", async () => {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    (loadSettings as any).mockResolvedValueOnce({
      transfer: { allowAutoTransfer: true, mode: "suggest_only", maxAutoTransferUsdt: 50 },
    });
    const r = await executeAutoTransferAndReaudit(baseInput);
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toContain("suggest_only");
  });

  it("4. amount > maxAutoTransferUsdt → blocked", async () => {
    const r = await executeAutoTransferAndReaudit({
      ...baseInput,
      transferPlan: { ...baseInput.transferPlan, amountUsdt: 999 },
    });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toContain("最大自动划转");
  });

  it("5. htx → blocked", async () => {
    const r = await executeAutoTransferAndReaudit({
      ...baseInput,
      transferPlan: { ...baseInput.transferPlan, exchange: "htx" },
    });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toContain("HTX");
  });

  it("6. dryRun=false but env not set → blocked", async () => {
    mockTransferInternal.mockRejectedValue(new Error("should not be called"));
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toContain("V121_ENABLE_REAL_INTERNAL_TRANSFER");
  });

  it("7. idempotencyKey duplicate submitted → return existing", async () => {
    const { findInternalTransferByIdempotencyKey } = await import("./internalTransferLedger");
    (findInternalTransferByIdempotencyKey as any).mockResolvedValueOnce({
      id: "existing", status: "submitted", idempotencyKey: "ik-dup",
      createdAtUtc: "2025-01-01T00:00:00Z", updatedAtUtc: "2025-01-01T00:00:00Z",
    });
    const r = await executeAutoTransferAndReaudit(baseInput);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("submitted");
  });

  it("8. adapter returns failed → failed", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockTransferInternal.mockResolvedValue({ ok: false, status: "failed", error: "insufficient_balance", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("9. adapter returns unknown → frozen", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockTransferInternal.mockResolvedValue({ ok: false, status: "frozen", error: "unknown", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("frozen");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("10. balances unchanged after transfer → frozen", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockTransferInternal.mockResolvedValue({ ok: true, status: "submitted", exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 20, idempotencyKey: "ik-test", transferId: "tx1", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("frozen");
    expect(r.blockers[0]).toContain("余额未变化");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("11. dryRun=false + env + okx → blocked", async () => {
    const r = await executeAutoTransferAndReaudit({
      ...baseInput,
      transferPlan: { ...baseInput.transferPlan, exchange: "okx" },
      dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toContain("okx_real_internal_transfer");
  });

  it("12. dryRun=false + binance + env enabled + submitted → balance_confirmed flow", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    // Before: spot 100. After: spot 80 (for retries, all same)
    const before = [{ asset: "USDT", free: 100, locked: 0, total: 100, exchange: "binance", fetchedAtUtc: "2025-01-01T00:00:00Z" }];
    const after = [{ asset: "USDT", free: 80, locked: 0, total: 80, exchange: "binance", fetchedAtUtc: "2025-01-01T00:00:01Z" }];
    // 1 before + up to 3 after retries = 4 calls
    mockFetchBalances
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after)
      .mockResolvedValueOnce(after)
      .mockResolvedValueOnce(after);
    mockTransferInternal.mockResolvedValue({ ok: true, status: "submitted", exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 20, idempotencyKey: "ik-12", transferId: "tx12", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("reaudit_passed");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  }, 15000);

  it("13. submit ok but balance unchanged → frozen", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    const same = [{ asset: "USDT", free: 100, locked: 0, total: 100, exchange: "binance", fetchedAtUtc: "2025-01-01T00:00:00Z" }];
    mockFetchBalances
      .mockResolvedValueOnce(same)
      .mockResolvedValueOnce(same)
      .mockResolvedValueOnce(same)
      .mockResolvedValueOnce(same);
    mockTransferInternal.mockResolvedValue({ ok: true, status: "submitted", exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 20, idempotencyKey: "ik-13", transferId: "tx13", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("frozen");
    expect(r.blockers[0]).toContain("余额未变化");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  }, 15000);
});
