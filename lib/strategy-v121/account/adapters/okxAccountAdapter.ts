/**
 * OKX 主网账户适配器
 *
 * V1.2.1: 读取余额/仓位/挂单 + 下单支持。(2026-06-29)
 *
 * 现货下单：POST /api/v5/trade/order, tdMode=cash
 * 永续下单：POST /api/v5/trade/order, tdMode=isolated (或 cross), 需 posSide
 *
 * 本适配器假设用户使用逐仓(isolated)模式。
 * 不支持：网格、冰山、TWAP 等高级订单类型。
 */

import type { ExchangeId } from "../../domain/types";
import type {
  IAccountAdapter, AccountBalanceSnapshot,
  AccountPositionSnapshot, OpenOrderSnapshot,
} from "../accountTypes";
import type { PlannedOrderLeg } from "../../execution/orderTypes";
import type { ExchangeOrderSubmissionResult } from "../../execution/orderExecutionTypes";
import { okxSign } from "./accountSigning";
import { safeFetch } from "./safeFetch";
import {
  isRealOrderExecutionEnabled,
  isRealCloseExecutionEnabled,
  isRealInternalTransferEnabled,
} from "../../config/runtimeConfig";

const BASE = "https://www.okx.com";

export class OkxAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "okx";

  private async signedGet(path: string): Promise<any> {
    const ts = new Date().toISOString();
    const { apiKey, passphrase, sign } = okxSign(ts, "GET", path, "");
    const result = await safeFetch(`${BASE}${path}`, {
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
    const { apiKey, passphrase, sign } = okxSign(ts, "POST", path, bodyStr);
    const result = await safeFetch(`${BASE}${path}`, {
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
      usdtValue: d.ccy === "USDT" ? Number(d.eq ?? 0) : undefined,
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
        side: p.posSide === "short" ? "perp_short" as const : "spot_long" as const,
        quantity: Math.abs(Number(p.pos ?? 0)),
        notionalUsdt: Math.abs(Number(p.notionalUsd ?? p.notional ?? 0)),
        entryPrice: Number(p.avgPx ?? 0),
        markPrice: Number(p.markPx ?? 0),
        unrealizedPnlUsdt: Number(p.upl ?? 0),
        marginRatio: Number(p.mgnRatio ?? 0),
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
      side: o.side === "buy" ? "buy" as const : "sell" as const,
      price: Number(o.px ?? 0),
      quantity: Number(o.sz ?? 0),
      filledQuantity: Number(o.accFillSz ?? 0),
      status: o.state === "live" ? "open" as const : "partially_filled" as const,
      createdAtUtc: o.cTime ? new Date(Number(o.cTime)).toISOString() : undefined,
      fetchedAtUtc: now,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/api/v5/public/time`);
      const body = await res.json();
      return body.code === "0";
    } catch {
      return false;
    }
  }

  async transferInternal(request: import("../../execution/internalTransferTypes").InternalTransferRequest): Promise<import("../../execution/internalTransferTypes").InternalTransferResult> {
    if (request.exchange !== "okx") return makeFailedTransfer(request, "exchange_mismatch");
    if (request.asset !== "USDT") return makeFailedTransfer(request, "only_usdt_supported");
    if (request.fromAccount === request.toAccount) return makeFailedTransfer(request, "same_account_transfer_rejected");
    if (request.dryRun) return { ok: true, status: "dry_run", exchange: "okx", asset: "USDT", fromAccount: request.fromAccount, toAccount: request.toAccount, amountUsdt: request.amountUsdt, idempotencyKey: request.idempotencyKey, warnings: ["dry_run_no_real_transfer"] };
    if (!isRealInternalTransferEnabled()) return makeFailedTransfer(request, "real_internal_transfer_env_disabled");

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

  async validateOrderPlan(plan: import("../../execution/orderTypes").TwoLegOrderPlan): Promise<{
    ok: boolean; blockers: string[]; warnings: string[]; raw?: unknown;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, unknown> = { precheck: null };

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

    if (plan.exchange !== "okx") {
      blockers.push("validateOrderPlan only supports okx");
      return { ok: false, blockers, warnings };
    }

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
      // order-precheck 返回 data 数组，通常第一个元素包含检查结果
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

    // Perp leg: 本地验证（OKX 暂无 perp 的 order-precheck）
    if (plan.perpLeg.quantity <= 0) blockers.push("perp quantity <= 0");
    if (plan.perpLeg.quoteNotionalUsdt < (plan.perpLeg.constraints.minNotional ?? 5)) {
      warnings.push(`perp notional < minNotional`);
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
      // OKX 查询订单：GET /api/v5/trade/order?instId=...&clOrdId=...
      const instId = toOkxInstId(input.symbol, input.market);
      const path = `/api/v5/trade/order?instId=${encodeURIComponent(instId)}&clOrdId=${encodeURIComponent(input.clientOrderId)}`;
      const data = await this.signedGet(path);
      if (!data || data.length === 0) {
        return {
          ok: false, exchange: "okx", symbol: input.symbol, market: input.market,
          role: input.market === "spot" ? "spot_buy" : "perp_short",
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

// ─── OKX Helper 函数 ────────────────────────────────────────

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
  request: import("../../execution/internalTransferTypes").InternalTransferRequest,
  error: string,
): import("../../execution/internalTransferTypes").InternalTransferResult {
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
  // 提交成功，状态设为 NEW（等待撮合）
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
