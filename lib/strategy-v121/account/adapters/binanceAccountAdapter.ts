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

  private async signedGet(base: string, path: string, extraParams?: Record<string, string>): Promise<any> {
    let query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
    if (extraParams) {
      const extra = new URLSearchParams(extraParams).toString();
      query = `${extra}&${query}`;
    }
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

  async validateOrderPlan(plan: import("../../execution/orderTypes").TwoLegOrderPlan): Promise<{
    ok: boolean; blockers: string[]; warnings: string[]; raw?: unknown;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, unknown> = { spotTest: null };

    if (plan.status !== "validated") {
      return { ok: false, blockers: [`order plan status is ${plan.status}; only validated plans can be exchange-tested`], warnings, raw };
    }

    if (!plan.spotLeg) {
      blockers.push("order plan missing spotLeg");
      return { ok: false, blockers, warnings, raw };
    }

    if (!plan.perpLeg) {
      blockers.push("order plan missing perpLeg");
      return { ok: false, blockers, warnings, raw };
    }

    if (!Number.isFinite(plan.spotLeg.quoteNotionalUsdt) || plan.spotLeg.quoteNotionalUsdt <= 0) {
      blockers.push("spotLeg.quoteNotionalUsdt must be positive");
    }

    if (!Number.isFinite(plan.perpLeg.quantity) || plan.perpLeg.quantity <= 0) {
      blockers.push("perpLeg.quantity must be positive");
    }

    if (blockers.length > 0) {
      return { ok: false, blockers, warnings, raw };
    }

    if (plan.exchange !== "binance") {
      blockers.push("validateOrderPlan only supports binance");
      return { ok: false, blockers, warnings };
    }

    // Spot leg: call POST /api/v3/order/test (does not enter matching engine)
    try {
      const spotParams: Record<string, string> = {
        symbol: plan.spotLeg.symbol.replace("/", ""),
        side: plan.spotLeg.side,
        type: plan.spotLeg.type,
        quoteOrderQty: plan.spotLeg.quoteNotionalUsdt.toFixed(8),
        newClientOrderId: plan.spotLeg.clientOrderId,
        timestamp: String(utcTimestampMs()),
        recvWindow: "5000",
      };
      const spotResult = await this.signedPost(SPOT, "/api/v3/order/test", spotParams);
      raw.spotTest = spotResult;
    } catch (e: any) {
      const msg = e.message ?? String(e);
      if (msg.includes("binance_universal_transfer_permission_required")) {
        blockers.push(msg);
      } else {
        blockers.push(`spot test order failed: ${msg}`);
      }
      raw.spotTest = { error: msg };
    }

    // Perp leg: local validation only (no /fapi/v1/order/test)
    if (plan.perpLeg.quantity <= 0) blockers.push("perp quantity <= 0");
    if (plan.perpLeg.quoteNotionalUsdt < (plan.perpLeg.constraints.minNotional ?? 5)) {
      blockers.push(`perp notional < minNotional`);
    }
    if (plan.perpLeg.clientOrderId.length > 36) {
      blockers.push("perp clientOrderId exceeds 36 chars");
    }

    return { ok: blockers.length === 0, blockers, warnings, raw };
  }

  // ─── Order Execution ──────────────────────────────────────

  async submitOrderLeg(leg: import("../../execution/orderTypes").PlannedOrderLeg, options: { dryRun: boolean; explicitConfirm?: string }): Promise<import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    if (leg.exchange !== "binance") return makeFailed(leg, "exchange_not_supported");
    if (leg.type !== "MARKET") return makeFailed(leg, "only_market_supported_first_version");
    if (!options.dryRun && options.explicitConfirm !== "EXECUTE_REAL_TWO_LEG_ORDER") return makeFailed(leg, "explicit_confirm_required");
    if (leg.role === "spot_buy") return this.submitSpotBuyMarket(leg, options.dryRun);
    if (leg.role === "perp_short") return this.submitPerpShortMarket(leg, options.dryRun);
    return makeFailed(leg, "unsupported_order_leg_role");
  }

  async fetchOrderByClientOrderId(input: { symbol: string; market: "spot" | "perp"; clientOrderId: string }): Promise<import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    try {
      const sym = input.symbol.replace("/", "");
      const base = input.market === "spot" ? SPOT : FUTURES;
      const path = input.market === "spot" ? "/api/v3/order" : "/fapi/v1/order";
      const data = await this.signedGet(base, path, { symbol: sym, origClientOrderId: input.clientOrderId });
      return {
        ok: true, exchange: "binance", symbol: input.symbol, market: input.market,
        role: data.side === "BUY" ? "spot_buy" : "perp_short",
        clientOrderId: input.clientOrderId,
        exchangeOrderId: String(data.orderId ?? ""),
        status: data.status ?? "UNKNOWN",
        executedQty: Number(data.executedQty ?? 0),
        executedQuoteQty: Number(data.cummulativeQuoteQty ?? 0),
        avgPrice: Number(data.avgPrice ?? 0),
        submittedAtUtc: new Date().toISOString(),
      };
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: input.symbol, market: input.market, role: "spot_buy", clientOrderId: input.clientOrderId, status: "UNKNOWN", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  private async submitSpotBuyMarket(leg: import("../../execution/orderTypes").PlannedOrderLeg, dryRun: boolean): Promise<import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (process.env.V121_ENABLE_REAL_ORDER_EXECUTION !== "1") return makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const response = await this.signedPost(SPOT, "/api/v3/order", {
        symbol: sym, side: "BUY", type: "MARKET",
        quoteOrderQty: normalizeAmount(leg.quoteNotionalUsdt),
        newClientOrderId: leg.clientOrderId,
        newOrderRespType: "FULL",
        recvWindow: "5000", timestamp: String(utcTimestampMs()),
      });
      return normalizeSpotResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "spot", role: "spot_buy", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  private async submitPerpShortMarket(leg: import("../../execution/orderTypes").PlannedOrderLeg, dryRun: boolean): Promise<import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (process.env.V121_ENABLE_REAL_ORDER_EXECUTION !== "1") return makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const params: Record<string, string> = {
        symbol: sym, side: "SELL", type: "MARKET",
        quantity: normalizeAmount(leg.quantity),
        newClientOrderId: leg.clientOrderId,
        recvWindow: "5000", timestamp: String(utcTimestampMs()),
      };
      if (leg.positionSide === "SHORT") params.positionSide = "SHORT";
      const response = await this.signedPost(FUTURES, "/fapi/v1/order", params);
      return normalizeFuturesResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "perp", role: "perp_short", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function normalizeAmount(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, "");
}

function makeFailed(leg: import("../../execution/orderTypes").PlannedOrderLeg, error: string): import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult {
  return { ok: false, exchange: leg.exchange, symbol: leg.symbol, market: leg.market, role: leg.role, clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error };
}

function dryRunResult(leg: import("../../execution/orderTypes").PlannedOrderLeg, status: string): import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult {
  return { ok: true, exchange: leg.exchange, symbol: leg.symbol, market: leg.market, role: leg.role, clientOrderId: leg.clientOrderId, status: status as any, submittedAtUtc: new Date().toISOString(), raw: { dryRun: true } };
}

function normalizeSpotResponse(response: any, leg: import("../../execution/orderTypes").PlannedOrderLeg): import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult {
  const status = response.status ?? "UNKNOWN";
  return {
    ok: status !== "REJECTED",
    exchange: "binance", symbol: leg.symbol, market: "spot", role: "spot_buy",
    clientOrderId: leg.clientOrderId,
    exchangeOrderId: String(response.orderId ?? ""),
    status,
    executedQty: Number(response.executedQty ?? 0),
    executedQuoteQty: Number(response.cummulativeQuoteQty ?? 0),
    avgPrice: Number(response.avgPrice ?? response.fills?.[0]?.price ?? 0),
    submittedAtUtc: new Date().toISOString(),
    raw: response,
  };
}

function normalizeFuturesResponse(response: any, leg: import("../../execution/orderTypes").PlannedOrderLeg): import("../../execution/orderExecutionTypes").ExchangeOrderSubmissionResult {
  const status = response.status ?? "UNKNOWN";
  return {
    ok: status !== "REJECTED",
    exchange: "binance", symbol: leg.symbol, market: "perp", role: "perp_short",
    clientOrderId: leg.clientOrderId,
    exchangeOrderId: String(response.orderId ?? ""),
    status,
    executedQty: Number(response.executedQty ?? 0),
    executedQuoteQty: Number(response.cummulativeQuoteQty ?? 0),
    avgPrice: Number(response.avgPrice ?? 0),
    submittedAtUtc: new Date().toISOString(),
    raw: response,
  };
}
