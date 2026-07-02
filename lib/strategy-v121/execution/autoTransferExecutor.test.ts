import { describe, expect, it, vi, beforeEach } from "vitest";
import { resetRuntimeConfig } from "../config/runtimeConfig";
import {
  executeAutoTransferAndReaudit,
  buildIdempotencyKey,
  isBalanceDirectionChanged,
  computeBalanceDelta,
  runHardTransferChecks,
  resolveIdempotency,
  loadAndValidateSettings,
} from "./autoTransferExecutor";

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
    resetRuntimeConfig();
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
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
    mockTransferInternal.mockResolvedValue({ ok: false, status: "failed", error: "insufficient_balance", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("9. adapter returns unknown → frozen", async () => {
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
    mockTransferInternal.mockResolvedValue({ ok: false, status: "frozen", error: "unknown", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("frozen");
  });

  it("10. balances unchanged after transfer → frozen", async () => {
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
    mockTransferInternal.mockResolvedValue({ ok: true, status: "submitted", exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp", amountUsdt: 20, idempotencyKey: "ik-test", transferId: "tx1", warnings: [] });
    const r = await executeAutoTransferAndReaudit({ ...baseInput, dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("frozen");
    expect(r.blockers[0]).toContain("余额未变化");
  });

  it("11. dryRun=false + env + okx → frozen (env not set), not blocked by exchange", async () => {
    mockTransferInternal.mockRejectedValue(new Error("should not be called"));
    const r = await executeAutoTransferAndReaudit({
      ...baseInput,
      transferPlan: { ...baseInput.transferPlan, exchange: "okx" },
      dryRun: false,
    });
    expect(r.ok).toBe(false);
    // OKX 不再因 exchange 被 blocked，而是被 V121_ENABLE_REAL_INTERNAL_TRANSFER env 阻挡
    expect(r.blockers[0]).toContain("V121_ENABLE_REAL_INTERNAL_TRANSFER");
  });

  it("12. dryRun=false + binance + env enabled + submitted → balance_confirmed flow", async () => {
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
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
  }, 15000);

  it("13. submit ok but balance unchanged → frozen", async () => {
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
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
  }, 15000);
});

describe("autoTransferExecutor helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeConfig();
  });

  describe("buildIdempotencyKey", () => {
    it("generates deterministic key from input", () => {
      const key = buildIdempotencyKey({
        exchange: "binance",
        fromAccount: "spot",
        toAccount: "perp",
        amountUsdt: 20,
        intentId: "intent-1",
      });
      expect(key).toBe("ik-binance-spot-perp-20-intent-1");
    });

    it("uses no-intent placeholder when intentId omitted", () => {
      const key = buildIdempotencyKey({
        exchange: "okx",
        fromAccount: "perp",
        toAccount: "spot",
        amountUsdt: 15,
      });
      expect(key).toBe("ik-okx-perp-spot-15-no-intent");
    });
  });

  describe("isBalanceDirectionChanged", () => {
    it("returns true when from decreases and to increases", () => {
      expect(isBalanceDirectionChanged(-20, 20)).toBe(true);
      expect(isBalanceDirectionChanged(-1, 1)).toBe(true);
    });

    it("returns false when delta is too small", () => {
      expect(isBalanceDirectionChanged(-0.5, 0.5)).toBe(false);
      expect(isBalanceDirectionChanged(0, 0)).toBe(false);
    });

    it("returns false when direction is wrong", () => {
      expect(isBalanceDirectionChanged(20, -20)).toBe(false);
      expect(isBalanceDirectionChanged(-20, -20)).toBe(false);
    });
  });

  describe("computeBalanceDelta", () => {
    const before = [{ asset: "USDT", free: 100 }];
    const afterDecreased = [{ asset: "USDT", free: 80 }];
    const afterIncreased = [{ asset: "USDT", free: 120 }];
    const unchanged = [{ asset: "USDT", free: 100 }];

    it("computes negative delta when free decreases", () => {
      expect(computeBalanceDelta(before, afterDecreased)).toBe(-20);
    });

    it("computes positive delta when free increases", () => {
      expect(computeBalanceDelta(before, afterIncreased)).toBe(20);
    });

    it("computes zero delta when unchanged", () => {
      expect(computeBalanceDelta(before, unchanged)).toBe(0);
    });

    it("sums multiple USDT entries", () => {
      const beforeMulti = [{ asset: "USDT", free: 50 }, { asset: "USDT", free: 50 }];
      const afterMulti = [{ asset: "USDT", free: 40 }, { asset: "USDT", free: 40 }];
      expect(computeBalanceDelta(beforeMulti, afterMulti)).toBe(-20);
    });

    it("ignores non-USDT assets", () => {
      const beforeMixed = [{ asset: "USDT", free: 100 }, { asset: "BTC", free: 1 }];
      const afterMixed = [{ asset: "USDT", free: 90 }, { asset: "BTC", free: 2 }];
      expect(computeBalanceDelta(beforeMixed, afterMixed)).toBe(-10);
    });

    it("returns 0 for invalid input", () => {
      expect(computeBalanceDelta(null, null)).toBe(0);
      expect(computeBalanceDelta("invalid", "invalid")).toBe(0);
    });
  });

  describe("runHardTransferChecks", () => {
    it("blocks HTX", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, exchange: "htx" }, true);
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("HTX");
    });

    it("blocks non-USDT asset", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, asset: "BTC" as any }, true);
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("USDT");
    });

    it("blocks same account transfer", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, fromAccount: "spot" as any, toAccount: "spot" as any }, true);
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("同账户");
    });

    it("allows dry-run for unsupported exchange", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, exchange: "okx" }, true);
      expect(r.ok).toBe(true);
    });

    it("blocks real transfer for unsupported exchange", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, exchange: "unknown" as any }, false);
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("unknown_real_internal_transfer_not_supported");
    });

    it("allows real okx transfer", () => {
      const r = runHardTransferChecks({ ...baseInput.transferPlan, exchange: "okx" }, false);
      expect(r.ok).toBe(true);
    });

    it("allows real binance transfer", () => {
      const r = runHardTransferChecks(baseInput.transferPlan, false);
      expect(r.ok).toBe(true);
    });
  });

  describe("resolveIdempotency", () => {
    it("returns continue when no existing record", async () => {
      const { findInternalTransferByIdempotencyKey } = await import("./internalTransferLedger");
      (findInternalTransferByIdempotencyKey as any).mockResolvedValueOnce(null);
      const r = await resolveIdempotency(baseInput.transferPlan, baseInput.intentId);
      expect(r.action).toBe("continue");
      expect((r as any).idempotencyKey).toBeTruthy();
    });

    it("returns existing for submitted/balance_confirmed/reaudit_passed", async () => {
      const { findInternalTransferByIdempotencyKey } = await import("./internalTransferLedger");
      for (const status of ["submitted", "balance_confirmed", "reaudit_passed"] as const) {
        (findInternalTransferByIdempotencyKey as any).mockResolvedValueOnce({
          id: "existing", status, idempotencyKey: "ik-dup",
          createdAtUtc: "2025-01-01T00:00:00Z", updatedAtUtc: "2025-01-01T00:00:00Z",
        });
        const r = await resolveIdempotency(baseInput.transferPlan, baseInput.intentId);
        expect(r.action).toBe("return_existing");
        expect(r.ok).toBe(true);
        expect(r.status).toBe(status);
      }
    });

    it("returns failed for failed/frozen", async () => {
      const { findInternalTransferByIdempotencyKey } = await import("./internalTransferLedger");
      for (const status of ["failed", "frozen"] as const) {
        (findInternalTransferByIdempotencyKey as any).mockResolvedValueOnce({
          id: "existing", status, idempotencyKey: "ik-dup",
          createdAtUtc: "2025-01-01T00:00:00Z", updatedAtUtc: "2025-01-01T00:00:00Z",
        });
        const r = await resolveIdempotency(baseInput.transferPlan, baseInput.intentId);
        expect(r.action).toBe("return_failed");
        expect(r.ok).toBe(false);
        expect(r.status).toBe(status);
      }
    });
  });

  describe("loadAndValidateSettings", () => {
    it("returns settings when all conditions met", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockResolvedValueOnce({
        transfer: { allowAutoTransfer: true, mode: "auto_transfer", maxAutoTransferUsdt: 50 },
      });
      const r = await loadAndValidateSettings({ transferPlan: { amountUsdt: 20 } }, "ledger-1");
      expect(r.ok).toBe(true);
      expect((r as any).settings).toBeDefined();
    });

    it("fails when autoTransfer disabled", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockResolvedValueOnce({
        transfer: { allowAutoTransfer: false, mode: "auto_transfer", maxAutoTransferUsdt: 50 },
      });
      const r = await loadAndValidateSettings({ transferPlan: { amountUsdt: 20 } }, "ledger-1");
      expect(r.ok).toBe(false);
      expect(r.status).toBe("failed");
      expect(r.blockers[0]).toContain("未启用");
    });

    it("fails when mode is disabled", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockResolvedValueOnce({
        transfer: { allowAutoTransfer: true, mode: "disabled", maxAutoTransferUsdt: 50 },
      });
      const r = await loadAndValidateSettings({ transferPlan: { amountUsdt: 20 } }, "ledger-1");
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("disabled");
    });

    it("fails when amount exceeds max", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockResolvedValueOnce({
        transfer: { allowAutoTransfer: true, mode: "auto_transfer", maxAutoTransferUsdt: 50 },
      });
      const r = await loadAndValidateSettings({ transferPlan: { amountUsdt: 100 } }, "ledger-1");
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("最大自动划转");
    });

    it("fails when safeExecutionDecision not executable", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockResolvedValueOnce({
        transfer: { allowAutoTransfer: true, mode: "auto_transfer", maxAutoTransferUsdt: 50 },
      });
      const r = await loadAndValidateSettings({
        transferPlan: { amountUsdt: 20 },
        safeExecutionDecision: { autoTransferExecutable: false },
      }, "ledger-1");
      expect(r.ok).toBe(false);
      expect(r.blockers[0]).toContain("autoTransferExecutable");
    });

    it("freezes when settings load fails", async () => {
      const { loadSettings } = await import("../settings/userStrategySettingsStore");
      (loadSettings as any).mockRejectedValueOnce(new Error("load failed"));
      const r = await loadAndValidateSettings({ transferPlan: { amountUsdt: 20 } }, "ledger-1");
      expect(r.ok).toBe(false);
      expect(r.status).toBe("frozen");
      expect(r.blockers[0]).toContain("load failed");
    });
  });
});
