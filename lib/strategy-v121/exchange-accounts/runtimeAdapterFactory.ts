/**
 * Runtime Adapter Factory — 根据用户保存的 API Key 构造运行时 adapter。
 *
 * 与 accountAdapterFactory 的区别：
 *  - accountAdapterFactory 从 process.env 读取密钥（运维预配置）。
 *  - runtimeAdapterFactory 接受运行时注入的明文密钥（从数据库解密得到），
 *    用于 probeAccount 等按账户探测的场景。
 *
 * 安全：
 *  - Binance 运行时 adapter 完整实现所有 IAccountAdapter 方法（下单/划转受环境变量和 dryRun 保护）。
 *  - OKX 运行时 adapter 完整实现所有 IAccountAdapter 方法（下单/划转受环境变量和 dryRun 保护）。
 *  - HTX 为 observe-only adapter，不支持账户探测。
 *  - 明文密钥仅在服务端内存中短暂持有，不写入日志，不返回给调用方。
 *  - 不检测提现权限作为唯一安全依据。
 */

import * as crypto from "node:crypto";
import type { ExchangeId } from "../domain/types";
import type {
  IAccountAdapter,
  AccountBalanceSnapshot,
  AccountPositionSnapshot,
  OpenOrderSnapshot,
} from "../account/accountTypes";
import type { InternalTransferResult, InternalTransferRequest } from "../execution/internalTransferTypes";
import type { ExchangeOrderSubmissionResult } from "../execution/orderExecutionTypes";
import type { PlannedOrderLeg, TwoLegOrderPlan } from "../execution/orderTypes";
import { safeFetch } from "../account/adapters/safeFetch";
import {
  createExchangeError,
  getErrorCode,
  isExchangeError,
} from "../account/adapters/exchangeError";
import {
  isRealCloseExecutionEnabled,
  isRealInternalTransferEnabled,
  isRealOrderExecutionEnabled,
} from "../config/runtimeConfig";

// ─── 运行时密钥输入 ─────────────────────────────────

export interface RuntimeApiKeyInput {
  exchange: ExchangeId;
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // OKX only
}

// ─── 工厂结果 ───────────────────────────────────────

export type RuntimeAdapterStatus = "ok" | "not_supported" | "observe_only";

export interface RuntimeAdapterFactoryResult {
  adapter: IAccountAdapter;
  status: RuntimeAdapterStatus;
  /** status !== "ok" 时的说明。 */
  message?: string;
}

// ─── Binance 运行时 adapter（完整实现）─────────────

const BINANCE_SPOT = "https://api.binance.com";
const BINANCE_FUTURES = "https://fapi.binance.com";

/**
 * Binance 运行时 adapter — 使用注入的 apiKey/secret 签名。
 *
 * 完整实现 IAccountAdapter 的所有方法，包括下单、划转、订单查询。
 * 签名逻辑与 accountSigning.binanceSign 一致，但密钥来自构造参数而非 process.env。
 */
class BinanceRuntimeAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "binance";
  readonly #apiKey: string;
  readonly #apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
  }

  private sign(queryString: string): { signature: string; apiKey: string } {
    const signature = crypto
      .createHmac("sha256", this.#apiSecret)
      .update(queryString)
      .digest("hex");
    return { signature, apiKey: this.#apiKey };
  }

  private async signedGet(
    base: string,
    path: string,
    extraParams?: Record<string, string>,
  ): Promise<any> {
    const ts = Date.now();
    let query = `timestamp=${ts}&recvWindow=5000`;
    if (extraParams) {
      const extra = new URLSearchParams(extraParams).toString();
      query = `${extra}&${query}`;
    }
    const { signature, apiKey } = this.sign(query);
    const url = `${base}${path}?${query}&signature=${signature}`;
    const result = await safeFetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    if (!result.ok) throw new Error(result.errorMessage ?? "Binance 请求失败");
    return result.body;
  }

  private async signedPost(
    base: string,
    path: string,
    params: Record<string, string>,
  ): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    const { signature, apiKey } = this.sign(qs);
    const url = `${base}${path}?${qs}&signature=${signature}`;
    const result = await safeFetch(url, { method: "POST", headers: { "X-MBX-APIKEY": apiKey } });
    if (!result.ok) {
      const bodyStr = typeof result.body === "object" ? JSON.stringify(result.body) : String(result.body ?? "");
      const code = result.body?.code;
      const msg = result.body?.msg ?? result.errorMessage ?? "";
      if (code === -2015 || /permission.?denied|not.?enabled/i.test(msg)) {
        throw createExchangeError("binance_universal_transfer_permission_required", -2015, result.body);
      }
      throw new Error(result.errorMessage ?? `Binance POST failed (${result.status})`);
    }
    return result.body;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet(BINANCE_SPOT, "/api/v3/account");
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
    const data = await this.signedGet(BINANCE_FUTURES, "/fapi/v2/positionRisk");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(p.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: Number(p.positionAmt) < 0 ? ("perp_short" as const) : ("spot_long" as const),
        quantity: Math.abs(Number(p.positionAmt)),
        notionalUsdt: Math.abs(Number(p.notional ?? 0)),
        entryPrice: Number(p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedPnlUsdt: Number(p.unRealizedProfit ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet(BINANCE_FUTURES, "/fapi/v1/openOrders");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((o: any) => o.status === "NEW" || o.status === "PARTIALLY_FILLED")
      .map((o: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(o.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: o.side === "BUY" ? ("buy" as const) : ("sell" as const),
        price: Number(o.price ?? 0),
        quantity: Number(o.origQty ?? 0),
        filledQuantity: Number(o.executedQty ?? 0),
        status: o.status === "NEW" ? ("open" as const) : ("partially_filled" as const),
        createdAtUtc: o.time ? new Date(Number(o.time)).toISOString() : undefined,
        fetchedAtUtc: now,
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BINANCE_FUTURES}/fapi/v1/ping`);
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
    if (!isRealInternalTransferEnabled()) return { ok: false, status: "failed", exchange: "binance", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, error: "real_internal_transfer_env_disabled", warnings: [] };

    try {
      const type = this.toBinanceUniversalTransferType({ fromAccount: request.fromAccount, toAccount: request.toAccount });
      const amount = binanceNormalizeTransferAmountUsdt(request.amountUsdt);
      const response = await this.signedPost(BINANCE_SPOT, "/sapi/v1/asset/transfer", {
        type, asset: request.asset, amount,
        timestamp: String(Date.now()), recvWindow: "5000",
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
        error: binanceNormalizeExchangeError(err), warnings: [], raw: this.safeRawError(err),
      };
    }
  }

  async validateOrderPlan(plan?: TwoLegOrderPlan): Promise<{
    ok: boolean; blockers: string[]; warnings: string[]; raw?: unknown;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, unknown> = { spotTest: null };

    if (!plan) {
      blockers.push("order plan is required");
      return { ok: false, blockers, warnings, raw };
    }

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
        timestamp: String(Date.now()),
        recvWindow: "5000",
      };
      const spotResult = await this.signedPost(BINANCE_SPOT, "/api/v3/order/test", spotParams);
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

    // Perp leg: local validation only
    if (plan.perpLeg.quantity <= 0) blockers.push("perp quantity <= 0");
    if (plan.perpLeg.quoteNotionalUsdt < (plan.perpLeg.constraints.minNotional ?? 5)) {
      blockers.push("perp notional < minNotional");
    }
    if (plan.perpLeg.clientOrderId.length > 36) {
      blockers.push("perp clientOrderId exceeds 36 chars");
    }

    return { ok: blockers.length === 0, blockers, warnings, raw };
  }

  async submitOrderLeg(leg: PlannedOrderLeg, options: { dryRun: boolean; explicitConfirm?: string }): Promise<ExchangeOrderSubmissionResult> {
    if (leg.exchange !== "binance") return this.makeFailed(leg, "exchange_not_supported");
    if (leg.type !== "MARKET") return this.makeFailed(leg, "only_market_supported_first_version");
    const isCloseLeg = leg.role === "spot_sell" || leg.role === "perp_buy_close";
    const expectedConfirm = isCloseLeg ? "EXECUTE_REAL_CLOSE_POSITION" : "EXECUTE_REAL_TWO_LEG_ORDER";
    if (!options.dryRun && options.explicitConfirm !== expectedConfirm) return this.makeFailed(leg, "explicit_confirm_required");
    if (leg.role === "spot_buy") return this.submitSpotBuyMarket(leg, options.dryRun);
    if (leg.role === "perp_short") return this.submitPerpShortMarket(leg, options.dryRun);
    if (leg.role === "perp_buy_close") return this.submitPerpBuyCloseMarket(leg, options.dryRun);
    if (leg.role === "spot_sell") return this.submitSpotSellMarket(leg, options.dryRun);
    return this.makeFailed(leg, "unsupported_order_leg_role");
  }

  async fetchOrderByClientOrderId(input: { symbol: string; market: "spot" | "perp"; clientOrderId: string }): Promise<ExchangeOrderSubmissionResult> {
    try {
      const sym = input.symbol.replace("/", "");
      const base = input.market === "spot" ? BINANCE_SPOT : BINANCE_FUTURES;
      const path = input.market === "spot" ? "/api/v3/order" : "/fapi/v1/order";
      const data = await this.signedGet(base, path, { symbol: sym, origClientOrderId: input.clientOrderId });
      return {
        ok: true, exchange: "binance", symbol: input.symbol, market: input.market,
        role: data.side === "BUY" ? (input.market === "perp" ? "perp_buy_close" : "spot_buy") : (input.market === "spot" ? "spot_sell" : "perp_short"),
        clientOrderId: input.clientOrderId,
        exchangeOrderId: String(data.orderId ?? ""),
        status: data.status ?? "UNKNOWN",
        executedQty: Number(data.executedQty ?? 0),
        executedQuoteQty: Number(data.cummulativeQuoteQty ?? 0),
        avgPrice: Number(data.avgPrice ?? 0),
        submittedAtUtc: new Date().toISOString(),
      };
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: input.symbol, market: input.market, role: input.market === "spot" ? "spot_sell" : "perp_buy_close", clientOrderId: input.clientOrderId, status: "UNKNOWN", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  // ─── Private order execution helpers ─────────────────

  private async submitSpotBuyMarket(leg: PlannedOrderLeg, dryRun: boolean): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return this.binanceDryRunResult(leg, "NEW");
    if (!isRealOrderExecutionEnabled()) return this.makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const response = await this.signedPost(BINANCE_SPOT, "/api/v3/order", {
        symbol: sym, side: "BUY", type: "MARKET",
        quoteOrderQty: binanceNormalizeAmount(leg.quoteNotionalUsdt),
        newClientOrderId: leg.clientOrderId,
        newOrderRespType: "FULL",
        recvWindow: "5000", timestamp: String(Date.now()),
      });
      return this.binanceNormalizeSpotResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "spot", role: "spot_buy", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  private async submitPerpShortMarket(leg: PlannedOrderLeg, dryRun: boolean): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return this.binanceDryRunResult(leg, "NEW");
    if (!isRealOrderExecutionEnabled()) return this.makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const params: Record<string, string> = {
        symbol: sym, side: "SELL", type: "MARKET",
        quantity: binanceNormalizeAmount(leg.quantity),
        newClientOrderId: leg.clientOrderId,
        recvWindow: "5000", timestamp: String(Date.now()),
      };
      if (leg.positionSide === "SHORT") params.positionSide = "SHORT";
      const response = await this.signedPost(BINANCE_FUTURES, "/fapi/v1/order", params);
      return this.binanceNormalizeFuturesResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "perp", role: "perp_short", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  private async submitPerpBuyCloseMarket(leg: PlannedOrderLeg, dryRun: boolean): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return this.binanceDryRunResult(leg, "NEW");
    if (!isRealCloseExecutionEnabled()) return this.makeFailed(leg, "real_close_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const mode = await this.getPositionMode();
      const params: Record<string, string> = {
        symbol: sym, side: "BUY", type: "MARKET",
        quantity: binanceNormalizeAmount(leg.quantity),
        newClientOrderId: leg.clientOrderId,
        recvWindow: "5000", timestamp: String(Date.now()),
      };
      if (mode === "hedge") {
        params.positionSide = "SHORT";
      } else {
        params.reduceOnly = "true";
      }
      const response = await this.signedPost(BINANCE_FUTURES, "/fapi/v1/order", params);
      return this.binanceNormalizeFuturesCloseResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "perp", role: "perp_buy_close", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  private async submitSpotSellMarket(leg: PlannedOrderLeg, dryRun: boolean): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return this.binanceDryRunResult(leg, "NEW");
    if (!isRealCloseExecutionEnabled()) return this.makeFailed(leg, "real_close_execution_env_disabled");
    try {
      const sym = leg.symbol.replace("/", "");
      const response = await this.signedPost(BINANCE_SPOT, "/api/v3/order", {
        symbol: sym, side: "SELL", type: "MARKET",
        quantity: binanceNormalizeAmount(leg.quantity),
        newClientOrderId: leg.clientOrderId,
        newOrderRespType: "FULL",
        recvWindow: "5000", timestamp: String(Date.now()),
      });
      return this.binanceNormalizeSpotCloseResponse(response, leg);
    } catch (e: any) {
      return { ok: false, exchange: "binance", symbol: leg.symbol, market: "spot", role: "spot_sell", clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error: e.message };
    }
  }

  /** 持仓模式缓存（同一执行内复用）。 */
  private positionModeCache: "hedge" | "one_way" | null = null;

  private async getPositionMode(): Promise<"hedge" | "one_way"> {
    if (this.positionModeCache) return this.positionModeCache;
    try {
      const data = await this.signedGet(BINANCE_FUTURES, "/fapi/v1/positionSide/dual");
      const dual = data?.dualSidePosition === true;
      this.positionModeCache = dual ? "hedge" : "one_way";
      return this.positionModeCache;
    } catch {
      this.positionModeCache = "one_way";
      return "one_way";
    }
  }

  private toBinanceUniversalTransferType(input: { fromAccount: "spot" | "perp"; toAccount: "spot" | "perp" }): "MAIN_UMFUTURE" | "UMFUTURE_MAIN" {
    if (input.fromAccount === "spot" && input.toAccount === "perp") return "MAIN_UMFUTURE";
    if (input.fromAccount === "perp" && input.toAccount === "spot") return "UMFUTURE_MAIN";
    throw new Error("unsupported_binance_internal_transfer_direction");
  }

  private makeFailed(leg: PlannedOrderLeg, error: string): ExchangeOrderSubmissionResult {
    return { ok: false, exchange: leg.exchange, symbol: leg.symbol, market: leg.market, role: leg.role, clientOrderId: leg.clientOrderId, status: "REJECTED", submittedAtUtc: new Date().toISOString(), error };
  }

  private binanceDryRunResult(leg: PlannedOrderLeg, status: string): ExchangeOrderSubmissionResult {
    return { ok: true, exchange: leg.exchange, symbol: leg.symbol, market: leg.market, role: leg.role, clientOrderId: leg.clientOrderId, status: status as ExchangeOrderSubmissionResult["status"], submittedAtUtc: new Date().toISOString(), raw: { dryRun: true } };
  }

  private binanceNormalizeSpotResponse(response: any, leg: PlannedOrderLeg): ExchangeOrderSubmissionResult {
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

  private binanceNormalizeFuturesResponse(response: any, leg: PlannedOrderLeg): ExchangeOrderSubmissionResult {
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

  private binanceNormalizeFuturesCloseResponse(response: any, leg: PlannedOrderLeg): ExchangeOrderSubmissionResult {
    const status = response.status ?? "UNKNOWN";
    return {
      ok: status !== "REJECTED",
      exchange: "binance", symbol: leg.symbol, market: "perp", role: "perp_buy_close",
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

  private binanceNormalizeSpotCloseResponse(response: any, leg: PlannedOrderLeg): ExchangeOrderSubmissionResult {
    const status = response.status ?? "UNKNOWN";
    return {
      ok: status !== "REJECTED",
      exchange: "binance", symbol: leg.symbol, market: "spot", role: "spot_sell",
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

  private safeRawError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        message: err.message,
        code: getErrorCode(err),
        raw: isExchangeError(err) ? err.raw : undefined,
      };
    }
    return { raw: String(err) };
  }
}

// ─── HTX observe-only adapter（不执行套利）──────────

class HtxObserveOnlyAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "htx";

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async healthCheck(): Promise<boolean> {
    // HTX 公共行情健康检查仍可执行
    try {
      const res = await fetch("https://api.huobi.pro/v2/market-status");
      return res.ok;
    } catch {
      return false;
    }
  }

  async transferInternal(): Promise<InternalTransferResult> {
    throw new Error("HTX observe-only adapter 不支持内部划转");
  }

  async validateOrderPlan(): Promise<{
    ok: boolean;
    blockers: string[];
    warnings: string[];
    raw?: unknown;
  }> {
    return {
      ok: false,
      blockers: ["htx_observe_only_not_available"],
      warnings: ["HTX 在 V1.2.1 中为 observe-only，不允许订单执行"],
    };
  }

  async submitOrderLeg(): Promise<ExchangeOrderSubmissionResult> {
    throw new Error("htx_observe_only: submitOrderLeg is not available");
  }

  async fetchOrderByClientOrderId(): Promise<ExchangeOrderSubmissionResult> {
    throw new Error("htx_observe_only: fetchOrderByClientOrderId is not available");
  }
}

// ─── OKX 运行时 adapter（完整实现）───────────────────

const OKX_BASE = "https://www.okx.com";

/**
 * OKX 运行时 adapter（完整实现）— 使用注入的 apiKey/secret/passphrase 签名。
 *
 * 签名逻辑与 accountSigning.okxSign 一致，但密钥来自构造参数而非 process.env。
 * 完整实现读取、下单、划转、订单查询等所有 IAccountAdapter 方法。
 * 下单/划转受环境变量和 dryRun 双重保护，与 OkxAccountAdapter 行为一致。
 */
class OkxRuntimeAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "okx";
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #passphrase: string;

  constructor(apiKey: string, apiSecret: string, passphrase: string) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
    this.#passphrase = passphrase;
  }

  /**
   * OKX 签名：Base64(HMAC-SHA256(timestamp + method + path + body))
   */
  private okxSign(
    timestamp: string,
    method: string,
    requestPath: string,
    body: string,
  ): { apiKey: string; passphrase: string; timestamp: string; sign: string } {
    const message = timestamp + method + requestPath + body;
    const sign = crypto
      .createHmac("sha256", this.#apiSecret)
      .update(message)
      .digest("base64");
    return { apiKey: this.#apiKey, passphrase: this.#passphrase, timestamp, sign };
  }

  private async signedGet(path: string): Promise<any> {
    const ts = new Date().toISOString();
    const { apiKey, passphrase, sign } = this.okxSign(ts, "GET", path, "");
    const result = await safeFetch(`${OKX_BASE}${path}`, {
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
    });
    if (!result.ok) throw new Error(result.errorMessage ?? "OKX 请求失败");
    if (result.body?.code !== "0") {
      throw new Error(`OKX API ${result.body?.code}: ${result.body?.msg ?? "未知错误"}`);
    }
    return result.body.data;
  }

  /**
   * OKX POST 签名请求。
   * body 是 JS 对象，自动 JSON.stringify。
   */
  private async signedPost(path: string, body: Record<string, unknown>): Promise<any> {
    const bodyStr = JSON.stringify(body);
    const ts = new Date().toISOString();
    const { apiKey, passphrase, sign } = this.okxSign(ts, "POST", path, bodyStr);
    const result = await safeFetch(`${OKX_BASE}${path}`, {
      method: "POST",
      body: bodyStr,
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
    });
    if (!result.ok) throw new Error(result.errorMessage ?? "OKX POST 请求失败");
    if (result.body?.code !== "0") {
      throw new Error(`OKX API ${result.body?.code}: ${result.body?.msg ?? "未知错误"}`);
    }
    return result.body.data;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet("/api/v5/account/balance");
    const now = new Date().toISOString();
    if (!data?.[0]?.details) return [];
    return data[0].details.map((d: any) => ({
      exchange: "okx" as ExchangeId,
      asset: d.ccy ?? d.currency ?? "?",
      free: Number(d.cashBal ?? d.availBal ?? 0),
      locked: Number(d.frozenBal ?? 0),
      total: Number(d.eq ?? (Number(d.cashBal ?? 0) + Number(d.frozenBal ?? 0))),
      fetchedAtUtc: now,
    }));
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    const data = await this.signedGet("/api/v5/account/positions");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.pos ?? 0)) > 0)
      .map((p: any) => ({
        exchange: "okx" as ExchangeId,
        symbol: String(p.instId ?? "").replace("-USDT-SWAP", "/USDT"),
        marketType: "perp" as const,
        side: p.posSide === "short" ? ("perp_short" as const) : ("spot_long" as const),
        quantity: Math.abs(Number(p.pos ?? 0)),
        notionalUsdt: Math.abs(Number(p.notionalUsd ?? p.notional ?? 0)),
        entryPrice: Number(p.avgPx ?? 0),
        markPrice: Number(p.markPx ?? 0),
        unrealizedPnlUsdt: Number(p.upl ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet("/api/v5/trade/orders-pending");
    const now = new Date().toISOString();
    return (data ?? []).map((o: any) => ({
      exchange: "okx" as ExchangeId,
      symbol: String(o.instId ?? "").replace("-USDT-SWAP", "/USDT"),
      marketType: "perp" as const,
      side: o.side === "buy" ? ("buy" as const) : ("sell" as const),
      price: Number(o.px ?? 0),
      quantity: Number(o.sz ?? 0),
      filledQuantity: Number(o.accFillSz ?? 0),
      status: o.state === "live" ? ("open" as const) : ("partially_filled" as const),
      createdAtUtc: o.cTime ? new Date(Number(o.cTime)).toISOString() : undefined,
      fetchedAtUtc: now,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${OKX_BASE}/api/v5/public/time`);
      const body = await res.json();
      return body.code === "0";
    } catch {
      return false;
    }
  }

  async transferInternal(request: InternalTransferRequest): Promise<InternalTransferResult> {
    if (request.exchange !== "okx") return makeFailedTransfer(request, "exchange_mismatch");
    if (request.asset !== "USDT") return makeFailedTransfer(request, "only_usdt_supported");
    if (request.fromAccount === request.toAccount) return makeFailedTransfer(request, "same_account_transfer_rejected");
    if (request.dryRun) {
      return {
        ok: true, status: "dry_run", exchange: "okx", asset: "USDT",
        fromAccount: request.fromAccount, toAccount: request.toAccount,
        amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey,
        warnings: ["dry_run_no_real_transfer"],
      };
    }

    // OKX 统一账户下，spot 和 perp 共享同一交易账户（18），无需 API 划转。
    // 仅当未来需要与资金账户（6）交互时才调用 POST /api/v5/asset/transfer。
    // 此处返回"模拟成功"，由 autoTransferExecutor 的 balance_confirmed 流程验证余额变化。
    return {
      ok: true, status: "submitted", exchange: "okx", asset: "USDT",
      fromAccount: request.fromAccount, toAccount: request.toAccount,
      amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey,
      submittedAtUtc: new Date().toISOString(),
      transferId: `okx-auto-${Date.now()}`,
      warnings: ["okx_unified_account_no_real_transfer_needed"],
      raw: { note: "OKX 统一账户 spot/perp 无需划转" },
    };
  }

  async validateOrderPlan(plan?: TwoLegOrderPlan): Promise<{
    ok: boolean; blockers: string[]; warnings: string[]; raw?: unknown;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, unknown> = { precheck: null };

    if (!plan) {
      blockers.push("order plan is required");
      return { ok: false, blockers, warnings, raw };
    }
    if (plan.status !== "validated") {
      return { ok: false, blockers: [`order plan status is ${plan.status}; only validated plans can be exchange-tested`], warnings, raw };
    }

    if (!plan.spotLeg) { blockers.push("order plan missing spotLeg"); return { ok: false, blockers, warnings, raw }; }
    if (!plan.perpLeg) { blockers.push("order plan missing perpLeg"); return { ok: false, blockers, warnings, raw }; }

    if (!Number.isFinite(plan.spotLeg.quoteNotionalUsdt) || plan.spotLeg.quoteNotionalUsdt <= 0) {
      blockers.push("spotLeg.quoteNotionalUsdt must be positive");
    }
    if (!Number.isFinite(plan.perpLeg.quantity) || plan.perpLeg.quantity <= 0) {
      blockers.push("perpLeg.quantity must be positive");
    }
    if (blockers.length > 0) return { ok: false, blockers, warnings, raw };

    // Spot leg: 调用 /api/v5/trade/order-precheck 做交易所级验证
    try {
      const spotInstId = toOkxInstId(plan.spotLeg.symbol, "spot");
      const precheckResult = await this.signedPost("/api/v5/trade/order-precheck", {
        instId: spotInstId,
        tdMode: "cash",
        side: "buy",
        ordType: "market",
        sz: normalizeAmount(plan.spotLeg.quoteNotionalUsdt),
        szType: "quote_ccy",
        clOrdId: plan.spotLeg.clientOrderId,
      });
      raw.precheck = precheckResult;
      if (precheckResult?.[0]) {
        const check = precheckResult[0];
        if (check.success !== true && check.success !== "true") {
          blockers.push(`OKX order-precheck failed: ${JSON.stringify(check)}`);
        }
      }
    } catch (e: any) {
      blockers.push(`OKX order-precheck error: ${e.message}`);
      raw.precheck = { error: e.message };
    }

    // Perp leg: 本地验证
    if (plan.perpLeg.quantity <= 0) blockers.push("perp quantity <= 0");
    if (plan.perpLeg.quoteNotionalUsdt < (plan.perpLeg.constraints.minNotional ?? 5)) {
      warnings.push("perp notional < minNotional");
    }
    if (plan.perpLeg.clientOrderId.length > 36) {
      blockers.push("perp clientOrderId exceeds 36 chars");
    }

    return { ok: blockers.length === 0, blockers, warnings, raw };
  }

  // ─── Order Execution ──────────────────────────────────────

  async submitOrderLeg(
    leg: PlannedOrderLeg,
    options: { dryRun: boolean; explicitConfirm?: string },
  ): Promise<ExchangeOrderSubmissionResult> {
    if (leg.exchange !== "okx") return makeFailed(leg, "exchange_not_supported");
    if (leg.type !== "MARKET") return makeFailed(leg, "only_market_supported_first_version");

    const isCloseLeg = leg.role === "spot_sell" || leg.role === "perp_buy_close";
    const expectedConfirm = isCloseLeg ? "EXECUTE_REAL_CLOSE_POSITION" : "EXECUTE_REAL_TWO_LEG_ORDER";
    if (!options.dryRun && options.explicitConfirm !== expectedConfirm) {
      return makeFailed(leg, "explicit_confirm_required");
    }

    if (leg.role === "spot_buy") return this.submitSpotBuyMarket(leg, options.dryRun);
    if (leg.role === "perp_short") return this.submitPerpShortMarket(leg, options.dryRun);
    if (leg.role === "perp_buy_close") return this.submitPerpBuyCloseMarket(leg, options.dryRun);
    if (leg.role === "spot_sell") return this.submitSpotSellMarket(leg, options.dryRun);

    return makeFailed(leg, "unsupported_order_leg_role");
  }

  async fetchOrderByClientOrderId(
    input: { symbol: string; market: "spot" | "perp"; clientOrderId: string },
  ): Promise<ExchangeOrderSubmissionResult> {
    try {
      const instId = toOkxInstId(input.symbol, input.market);
      const path = `/api/v5/trade/order?instId=${encodeURIComponent(instId)}&clOrdId=${encodeURIComponent(input.clientOrderId)}`;
      const data = await this.signedGet(path);
      if (!data || data.length === 0) {
        return {
          ok: false, exchange: "okx", symbol: input.symbol, market: input.market,
          role: input.market === "perp" ? "perp_buy_close" : "spot_buy",
          clientOrderId: input.clientOrderId, status: "UNKNOWN",
          submittedAtUtc: new Date().toISOString(), error: "order_not_found",
        };
      }
      return normalizeOkxOrderResponse(data[0], input);
    } catch (e: any) {
      return {
        ok: false, exchange: "okx", symbol: input.symbol, market: input.market,
        role: input.market === "spot" ? "spot_buy" : "perp_short",
        clientOrderId: input.clientOrderId, status: "UNKNOWN",
        submittedAtUtc: new Date().toISOString(), error: e.message,
      };
    }
  }

  // ─── Private submit helpers ────────────────────────────────

  /** 现货 BUY（开仓买入）— 市价单，按 quote 金额 */
  private async submitSpotBuyMarket(
    leg: PlannedOrderLeg, dryRun: boolean,
  ): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (!isRealOrderExecutionEnabled()) return makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const instId = toOkxInstId(leg.symbol, "spot");
      const response = await this.signedPost("/api/v5/trade/order", {
        instId,
        tdMode: "cash",
        side: "buy",
        ordType: "market",
        sz: normalizeAmount(leg.quoteNotionalUsdt),
        szType: "quote_ccy",
        clOrdId: leg.clientOrderId,
      });
      return normalizeOkxSubmitResponse(response?.[0], leg);
    } catch (e: any) {
      return makeFailed(leg, e.message);
    }
  }

  /** 永续 SELL（做空开仓）— 市价单，按合约张数 */
  private async submitPerpShortMarket(
    leg: PlannedOrderLeg, dryRun: boolean,
  ): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (!isRealOrderExecutionEnabled()) return makeFailed(leg, "real_order_execution_env_disabled");
    try {
      const instId = toOkxInstId(leg.symbol, "perp");
      const response = await this.signedPost("/api/v5/trade/order", {
        instId,
        tdMode: "isolated",
        side: "sell",
        posSide: "short",
        ordType: "market",
        sz: normalizeAmount(leg.quantity),
        clOrdId: leg.clientOrderId,
      });
      return normalizeOkxSubmitResponse(response?.[0], leg);
    } catch (e: any) {
      return makeFailed(leg, e.message);
    }
  }

  /** 永续 BUY（平空） */
  private async submitPerpBuyCloseMarket(
    leg: PlannedOrderLeg, dryRun: boolean,
  ): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (!isRealCloseExecutionEnabled()) return makeFailed(leg, "real_close_execution_env_disabled");
    try {
      const instId = toOkxInstId(leg.symbol, "perp");
      const response = await this.signedPost("/api/v5/trade/order", {
        instId,
        tdMode: "isolated",
        side: "buy",
        posSide: "short",
        ordType: "market",
        sz: normalizeAmount(leg.quantity),
        clOrdId: leg.clientOrderId,
      });
      return normalizeOkxSubmitResponse(response?.[0], leg);
    } catch (e: any) {
      return makeFailed(leg, e.message);
    }
  }

  /** 现货 SELL（平多卖出） */
  private async submitSpotSellMarket(
    leg: PlannedOrderLeg, dryRun: boolean,
  ): Promise<ExchangeOrderSubmissionResult> {
    if (dryRun) return dryRunResult(leg, "NEW");
    if (!isRealCloseExecutionEnabled()) return makeFailed(leg, "real_close_execution_env_disabled");
    try {
      const instId = toOkxInstId(leg.symbol, "spot");
      const response = await this.signedPost("/api/v5/trade/order", {
        instId,
        tdMode: "cash",
        side: "sell",
        ordType: "market",
        sz: normalizeAmount(leg.quantity),
        szType: "base_ccy",
        clOrdId: leg.clientOrderId,
      });
      return normalizeOkxSubmitResponse(response?.[0], leg);
    } catch (e: any) {
      return makeFailed(leg, e.message);
    }
  }
}

// ─── OKX 运行时 Helper 函数 ───────────────────────────────────

/**
 * 将内部符号（如 "BTC/USDT"）转为 OKX instId。
 * spot: "BTC-USDT"
 * perp: "BTC-USDT-SWAP"
 */
function toOkxInstId(symbol: string, market: "spot" | "perp"): string {
  const dash = symbol.replace("/", "-");
  if (market === "perp") return `${dash}-SWAP`;
  return dash;
}

/** 数字格式化为 OKX 可接受的字符串（去掉尾随零） */
function normalizeAmount(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, "");
}

function makeFailed(
  leg: PlannedOrderLeg, error: string,
): ExchangeOrderSubmissionResult {
  return {
    ok: false, exchange: "okx", symbol: leg.symbol, market: leg.market,
    role: leg.role, clientOrderId: leg.clientOrderId,
    status: "REJECTED", submittedAtUtc: new Date().toISOString(), error,
  };
}

function makeFailedTransfer(
  request: InternalTransferRequest, error: string,
): InternalTransferResult {
  return {
    ok: false, status: "failed", exchange: "okx", asset: "USDT",
    fromAccount: request.fromAccount, toAccount: request.toAccount,
    amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey,
    error, warnings: [],
  };
}

function dryRunResult(
  leg: PlannedOrderLeg, status: ExchangeOrderSubmissionResult["status"],
): ExchangeOrderSubmissionResult {
  return {
    ok: true, exchange: "okx", symbol: leg.symbol, market: leg.market,
    role: leg.role, clientOrderId: leg.clientOrderId,
    status, submittedAtUtc: new Date().toISOString(),
    raw: { dryRun: true },
  };
}

/**
 * 统一处理 OKX submit 返回结果。
 * OKX 返回 data: [{ clOrdId, ordId, sCode, sMsg }]，
 * sCode="0" 表示订单提交成功（不代表最终成交）。
 */
function normalizeOkxSubmitResponse(
  data: any, leg: PlannedOrderLeg,
): ExchangeOrderSubmissionResult {
  if (!data) return makeFailed(leg, "okx_empty_submit_response");
  const sCode = String(data.sCode ?? "");
  if (sCode !== "0") {
    return {
      ok: false, exchange: "okx", symbol: leg.symbol, market: leg.market,
      role: leg.role, clientOrderId: leg.clientOrderId,
      status: "REJECTED", submittedAtUtc: new Date().toISOString(),
      exchangeOrderId: String(data.ordId ?? ""),
      error: `okx_submit_error: sCode=${sCode} msg=${data.sMsg ?? ""}`,
      raw: data,
    };
  }
  return {
    ok: true, exchange: "okx", symbol: leg.symbol, market: leg.market,
    role: leg.role, clientOrderId: leg.clientOrderId,
    exchangeOrderId: String(data.ordId ?? ""),
    status: "NEW", submittedAtUtc: new Date().toISOString(),
    raw: data,
  };
}

/**
 * 处理 fetchOrderByClientOrderId 返回。
 * OKX 返回 data: [{ instId, ordId, clOrdId, state, sz, fillSz, avgPx, ... }]
 * state: "live" | "partially_filled" | "filled" | "canceled" | "failed"
 */
function normalizeOkxOrderResponse(
  data: any,
  input: { symbol: string; market: "spot" | "perp"; clientOrderId: string },
): ExchangeOrderSubmissionResult {
  const state = String(data.state ?? "");
  const statusMap: Record<string, ExchangeOrderSubmissionResult["status"]> = {
    live: "NEW",
    partially_filled: "PARTIALLY_FILLED",
    filled: "FILLED",
    canceled: "CANCELED",
    failed: "REJECTED",
  };
  const status = statusMap[state] ?? "UNKNOWN";
  const side = String(data.side ?? "");
  const role = side === "buy"
    ? (input.market === "perp" ? "perp_buy_close" as const : "spot_buy" as const)
    : (input.market === "spot" ? "spot_sell" as const : "perp_short" as const);

  return {
    ok: status !== "REJECTED" && status !== "CANCELED",
    exchange: "okx", symbol: input.symbol, market: input.market,
    role,
    clientOrderId: input.clientOrderId,
    exchangeOrderId: String(data.ordId ?? ""),
    status,
    executedQty: Number(data.accFillSz ?? data.fillSz ?? 0),
    executedQuoteQty: Number(data.feeCcy === "USDT" ? (Number(data.fee ?? 0) * -1) : 0),
    avgPrice: Number(data.avgPx ?? 0),
    submittedAtUtc: new Date().toISOString(),
    raw: data,
  };
}

// ─── 工厂入口 ───────────────────────────────────────

/**
 * 根据运行时密钥构造 adapter。
 *
 * @param input - 运行时密钥输入（从数据库解密得到）。
 * @returns { adapter, status, message }
 *  - status="ok": Binance（只读），OKX（完整实现）。
 *  - status="not_supported": 密钥不完整或不支持。
 *  - status="observe_only": HTX，仅观察，不执行套利探测。
 */
export function createRuntimeAdapter(input: RuntimeApiKeyInput): RuntimeAdapterFactoryResult {
  switch (input.exchange) {
    case "binance":
      if (!input.apiKey || !input.apiSecret) {
        return {
          adapter: new OkxRuntimeAdapter("", "", ""),
          status: "not_supported",
          message: "Binance 运行时密钥不完整（apiKey 或 apiSecret 为空）",
        };
      }
      return {
        adapter: new BinanceRuntimeAdapter(input.apiKey, input.apiSecret),
        status: "ok",
      };

    case "okx":
      if (!input.apiKey || !input.apiSecret) {
        return {
          adapter: new OkxRuntimeAdapter("", "", ""),
          status: "not_supported",
          message: "OKX 运行时密钥不完整（apiKey 或 apiSecret 为空）",
        };
      }
      return {
        adapter: new OkxRuntimeAdapter(
          input.apiKey,
          input.apiSecret,
          input.passphrase ?? "",
        ),
        status: "ok",
      };

    case "htx":
      // HTX observe-only — 不执行套利探测。
      return {
        adapter: new HtxObserveOnlyAdapter(),
        status: "observe_only",
        message: "HTX 在 V1.2.1 中为 observe-only，不可用于套利执行",
      };

    default:
      return {
        adapter: new OkxRuntimeAdapter("", "", ""),
        status: "not_supported",
        message: `不支持的交易所: ${input.exchange}`,
      };
  }
}

// ─── Binance helper 函数 ───────────────────────────────

function binanceNormalizeAmount(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, "");
}

function binanceNormalizeTransferAmountUsdt(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_transfer_amount");
  const normalized = Math.floor(amount * 100_000_000) / 100_000_000;
  if (normalized <= 0) throw new Error("transfer_amount_too_small_after_rounding");
  return normalized.toString();
}

function binanceNormalizeExchangeError(err: unknown): string {
  if (err instanceof Error) {
    if (getErrorCode(err) === -2015) return "binance_universal_transfer_permission_required";
    return err.message;
  }
  return String(err);
}
