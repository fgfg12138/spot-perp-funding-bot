/**
 * Binance 主网只读账户适配器
 *
 * 读取现货余额、合约仓位、当前挂单。
 * 不下单、不撤单、不改杠杆、不划转。
 */

import type { ExchangeId } from "../../domain/types";
import type {
  IAccountAdapter, AccountBalanceSnapshot,
  AccountPositionSnapshot, OpenOrderSnapshot,
} from "../accountTypes";
import { binanceSign, utcTimestampMs } from "./accountSigning";
import { safeFetch } from "./safeFetch";
import type { InternalTransferRequest, InternalTransferResult } from "../../execution/internalTransferTypes";

const SPOT = "https://api.binance.com";
const FUTURES = "https://fapi.binance.com";

// ─── Helper functions ──────────────────────────────────────

function toBinanceUniversalTransferType(input: { fromAccount: "spot" | "perp"; toAccount: "spot" | "perp" }): "MAIN_UMFUTURE" | "UMFUTURE_MAIN" {
  if (input.fromAccount === "spot" && input.toAccount === "perp") return "MAIN_UMFUTURE";
  if (input.fromAccount === "perp" && input.toAccount === "spot") return "UMFUTURE_MAIN";
  throw new Error("unsupported_binance_internal_transfer_direction");
}

function normalizeTransferAmountUsdt(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_transfer_amount");
  const normalized = Math.floor(amount * 100_000_000) / 100_000_000;
  if (normalized <= 0) throw new Error("transfer_amount_too_small_after_rounding");
  return normalized.toString();
}

function normalizeExchangeError(err: unknown): string {
  if (err instanceof Error) {
    if ((err as any).code === -2015) return "binance_universal_transfer_permission_required";
    return err.message;
  }
  return String(err);
}

function safeRawError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { message: err.message, code: (err as any).code, raw: (err as any).raw };
  return { raw: String(err) };
}

export class BinanceAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "binance";

  private async signedGet(base: string, path: string): Promise<any> {
    const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
    const { signature, apiKey } = binanceSign(query);
    const url = `${base}${path}?${query}&signature=${signature}`;
    const result = await safeFetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    if (!result.ok) throw new Error(result.errorMessage ?? "Binance 请求失败");
    return result.body;
  }

  private async signedPost(base: string, path: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    const { signature, apiKey } = binanceSign(qs);
    const url = `${base}${path}?${qs}&signature=${signature}`;
    const result = await safeFetch(url, { method: "POST", headers: { "X-MBX-APIKEY": apiKey } });
    if (!result.ok) {
      const bodyStr = typeof result.body === "object" ? JSON.stringify(result.body) : String(result.body ?? "");
      const code = result.body?.code;
      const msg = result.body?.msg ?? result.errorMessage ?? "";
      if (code === -2015 || /permission.?denied|not.?enabled/i.test(msg)) {
        const err = new Error("binance_universal_transfer_permission_required");
        (err as any).code = -2015;
        (err as any).raw = result.body;
        throw err;
      }
      throw new Error(result.errorMessage ?? `Binance POST failed (${result.status})`);
    }
    return result.body;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet(SPOT, "/api/v3/account");
    const now = new Date().toISOString();
    return (data.balances ?? [])
      .filter((b: any) => Number(b.free) > 0 || Number(b.locked) > 0)
      .map((b: any) => ({
        exchange: "binance" as ExchangeId,
        asset: b.asset,
        free: Number(b.free),
        locked: Number(b.locked),
        total: Number(b.free) + Number(b.locked),
        fetchedAtUtc: now,
      }));
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    const data = await this.signedGet(FUTURES, "/fapi/v2/positionRisk");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(p.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: Number(p.positionAmt) < 0 ? "perp_short" as const : "spot_long" as const,
        quantity: Math.abs(Number(p.positionAmt)),
        notionalUsdt: Math.abs(Number(p.notional ?? 0)),
        entryPrice: Number(p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedPnlUsdt: Number(p.unRealizedProfit ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet(FUTURES, "/fapi/v1/openOrders");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((o: any) => o.status === "NEW" || o.status === "PARTIALLY_FILLED")
      .map((o: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(o.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: o.side === "BUY" ? "buy" as const : "sell" as const,
        price: Number(o.price ?? 0),
        quantity: Number(o.origQty ?? 0),
        filledQuantity: Number(o.executedQty ?? 0),
        status: o.status === "NEW" ? "open" as const : "partially_filled" as const,
        createdAtUtc: o.time ? new Date(Number(o.time)).toISOString() : undefined,
        fetchedAtUtc: now,
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${FUTURES}/fapi/v1/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async transferInternal(request: InternalTransferRequest): Promise<InternalTransferResult> {
    if (request.exchange !== "binance") return { ok: false, status: "failed", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, error: "exchange_mismatch", warnings: [] };
    if (request.asset !== "USDT") return { ok: false, status: "failed", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, error: "only_usdt_supported", warnings: [] };
    if (request.fromAccount === request.toAccount) return { ok: false, status: "failed", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, error: "same_account_transfer_rejected", warnings: [] };
    if (request.dryRun) return { ok: true, status: "dry_run", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, warnings: ["dry_run_no_real_transfer"] };
    if (process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER !== "1") return { ok: false, status: "failed", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, error: "real_internal_transfer_env_disabled", warnings: [] };

    try {
      const type = toBinanceUniversalTransferType({ fromAccount: request.fromAccount, toAccount: request.toAccount });
      const amount = normalizeTransferAmountUsdt(request.amountUsdt);
      const response = await this.signedPost(SPOT, "/sapi/v1/asset/transfer", {
        type, asset: request.asset, amount,
        timestamp: String(utcTimestampMs()), recvWindow: "5000",
      });
      return {
        ok: true, status: "submitted", exchange: "binance", asset: "USDT",
        fromAccount: request.fromAccount, toAccount: request.toAccount,
        amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey,
        transferId: String(response.tranId ?? ""), submittedAtUtc: new Date().toISOString(),
        warnings: [], raw: response,
      };
    } catch (err) {
      return {
        ok: false, status: "failed", exchange: "binance", asset: "USDT",
        fromAccount: request.fromAccount, toAccount: request.toAccount,
        amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey,
        error: normalizeExchangeError(err), warnings: [], raw: safeRawError(err),
      };
    }
  }
}
