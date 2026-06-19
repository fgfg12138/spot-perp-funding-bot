import { describe, expect, it, vi, beforeEach } from "vitest";
import { BinanceAccountAdapter } from "./binanceAccountAdapter";

const mockSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("./safeFetch", () => ({
  safeFetch: mockSafeFetch,
}));

vi.mock("./accountSigning", () => ({
  binanceSign: vi.fn().mockReturnValue({ signature: "mocked_signature", apiKey: "mocked_api_key" }),
  utcTimestampMs: vi.fn().mockReturnValue(1700000000000),
}));

describe("BinanceAccountAdapter transferInternal", () => {
  let adapter: BinanceAccountAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BinanceAccountAdapter();
  });

  it("1. dryRun=true does NOT call POST", async () => {
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-1", dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("dry_run");
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("2. spot→perp maps to MAIN_UMFUTURE", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({ ok: true, body: { tranId: "12345" } });
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-2", dryRun: false,
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("submitted");
    const calledUrl = mockSafeFetch.mock.calls[0][0];
    expect(calledUrl).toContain("MAIN_UMFUTURE");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("3. perp→spot maps to UMFUTURE_MAIN", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({ ok: true, body: { tranId: "12345" } });
    await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "perp", toAccount: "spot",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-3", dryRun: false,
    });
    const calledUrl = mockSafeFetch.mock.calls[0][0];
    expect(calledUrl).toContain("UMFUTURE_MAIN");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("4. same account rejected", async () => {
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "spot",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-4", dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("same_account_transfer_rejected");
  });

  it("5. non-USDT rejected", async () => {
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "BUSD", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-5", dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("only_usdt_supported");
  });

  it("6. env not set → real_internal_transfer_env_disabled", async () => {
    delete process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-6", dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("real_internal_transfer_env_disabled");
  });

  it("7. env enabled → calls POST /sapi/v1/asset/transfer", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({ ok: true, body: { tranId: "67890" } });
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-7", dryRun: false,
    });
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockSafeFetch.mock.calls[0][0];
    expect(calledUrl).toContain("/sapi/v1/asset/transfer");
    expect(r.ok).toBe(true);
    expect(r.transferId).toBe("67890");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("8. transferId from tranId", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({ ok: true, body: { tranId: 98765 } });
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-8", dryRun: false,
    });
    expect(r.transferId).toBe("98765");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("9. permission error → binance_universal_transfer_permission_required", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({
      ok: false, status: 400,
      body: { code: -2015, msg: "This API key does not have permission" },
      errorMessage: "Binance 请求失败",
    });
    const r = await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 10, reason: "test", idempotencyKey: "ik-9", dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("binance_universal_transfer_permission_required");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });

  it("10. float amount normalized", async () => {
    const origEnv = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER;
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = "1";
    mockSafeFetch.mockResolvedValue({ ok: true, body: { tranId: "11111" } });
    await adapter.transferInternal({
      exchange: "binance", asset: "USDT", fromAccount: "spot", toAccount: "perp",
      amountUsdt: 20.000000000000004, reason: "test", idempotencyKey: "ik-10", dryRun: false,
    });
    const calledUrl = mockSafeFetch.mock.calls[0][0];
    expect(calledUrl).toContain("amount=20");
    expect(calledUrl).not.toContain("20.000000000000004");
    process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER = origEnv;
  });
});
