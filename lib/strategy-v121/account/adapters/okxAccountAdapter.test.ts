/**
 * OkxAccountAdapter 单元测试 — 全面覆盖
 *
 * 通过 mock safeFetch 验证所有方法的完整行为：
 * - submitOrderLeg: 4个角色分支 + 异常场景（超时/拒绝/空响应/sCode错误）
 * - validateOrderPlan: precheck成功/失败 + 本地验证 + 异常
 * - fetchOrderByClientOrderId: 全部5种状态映射 + 未找到 + API错误
 * - transferInternal: 统一账户/只USDT/dryRun/env门禁/exchange不匹配/同账户
 * - healthCheck: 正常/HTTP异常/非预期响应
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("./safeFetch", () => ({
  safeFetch: mockSafeFetch,
}));

vi.mock("./accountSigning", () => ({
  okxSign: (_ts: string, _method: string, _path: string, _body: string) => ({
    apiKey: "mock-key",
    passphrase: "mock-passphrase",
    sign: "mock-signature",
  }),
}));

import { OkxAccountAdapter } from "./okxAccountAdapter";
import type { PlannedOrderLeg } from "../../execution/orderTypes";
import type { TwoLegOrderPlan } from "../../execution/orderTypes";
import { resetRuntimeConfig } from "../../config/runtimeConfig";

// ── Test fixtures ────────────────────────────────────────────

const spotBuyLeg: PlannedOrderLeg = {
  role: "spot_buy",
  exchange: "okx",
  symbol: "BTC/USDT",
  market: "spot",
  side: "BUY",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60000,
  clientOrderId: "v121_spot_buy_test",
  reduceOnly: false,
  constraints: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5 },
};

const perpShortLeg: PlannedOrderLeg = {
  role: "perp_short",
  exchange: "okx",
  symbol: "BTC/USDT",
  market: "perp",
  side: "SELL",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60001,
  clientOrderId: "v121_perp_short_test",
  reduceOnly: false,
  positionSide: "SHORT",
  constraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
};

const perpBuyCloseLeg: PlannedOrderLeg = {
  role: "perp_buy_close",
  exchange: "okx",
  symbol: "BTC/USDT",
  market: "perp",
  side: "BUY",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60000,
  clientOrderId: "v121_perp_close_test",
  reduceOnly: true,
  positionSide: "SHORT",
  constraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
};

const spotSellLeg: PlannedOrderLeg = {
  role: "spot_sell",
  exchange: "okx",
  symbol: "BTC/USDT",
  market: "spot",
  side: "SELL",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60000,
  clientOrderId: "v121_spot_sell_test",
  reduceOnly: false,
  constraints: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5 },
};

const validPlan: TwoLegOrderPlan = {
  id: "oplan-test",
  exchange: "okx",
  symbol: "BTC/USDT",
  status: "validated",
  plannedNotionalUsdt: 60,
  spotLeg: spotBuyLeg,
  perpLeg: perpShortLeg,
  blockers: [],
  warnings: [],
  allowedForActualOrder: false,
  createdAtUtc: new Date().toISOString(),
  expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
};

// ── Helper: default success response for POST /api/v5/trade/order ──

function makeSubmitOkResponse(ordId = "mock-ord-123") {
  return {
    ok: true,
    body: { code: "0", msg: "", data: [{ clOrdId: "mock-cl", ordId, sCode: "0", sMsg: "" }] },
  };
}

function makeSubmitFailedResponse(sCode: string, sMsg: string) {
  return {
    ok: true,
    body: { code: "0", msg: "", data: [{ clOrdId: "mock-cl", ordId: "", sCode, sMsg }] },
  };
}

function makeSafeFetchError(errorMessage: string) {
  return { ok: false, errorMessage };
}

function makePrecheckOkResponse() {
  return {
    ok: true,
    body: { code: "0", msg: "", data: [{ success: true }] },
  };
}

function makePrecheckFailResponse() {
  return {
    ok: true,
    body: { code: "0", msg: "", data: [{ success: false, ccode: "1", cmsg: "Insufficient balance" }] },
  };
}

function makeOrderQueryResponse(state: string) {
  return {
    ok: true,
    body: {
      code: "0", msg: "",
      data: [{ instId: "BTC-USDT", ordId: "mock-ord", clOrdId: "mock-cl", state, sz: "0.001", accFillSz: "0.001", avgPx: "60000", side: "buy", fillSz: "0", fee: "0", feeCcy: "USDT" }],
    },
  };
}

function makeOrderQueryResponseSell(state: string) {
  return {
    ok: true,
    body: {
      code: "0", msg: "",
      data: [{ instId: "BTC-USDT", ordId: "mock-ord", clOrdId: "mock-cl", state, sz: "0.001", accFillSz: "0", avgPx: "0", side: "sell", fillSz: "0", fee: "0", feeCcy: "USDT" }],
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("OkxAccountAdapter", () => {
  let adapter: OkxAccountAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OkxAccountAdapter();
    resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
  });

  afterEach(() => {
    resetRuntimeConfig({});
  });

  // ════════════════════════════════════════════════════════════
  // submitOrderLeg
  // ════════════════════════════════════════════════════════════

  describe("submitOrderLeg - spot_buy (开仓买入)", () => {
    it("sends correct OKX POST body for spot_buy market order", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockSafeFetch.mock.calls[0];
      expect(callArgs[0]).toContain("/api/v5/trade/order");
      const body = JSON.parse(callArgs[1].body);
      expect(body.instId).toBe("BTC-USDT");
      expect(body.tdMode).toBe("cash");
      expect(body.side).toBe("buy");
      expect(body.ordType).toBe("market");
      expect(body.szType).toBe("quote_ccy");
      expect(body.clOrdId).toBe("v121_spot_buy_test");
      expect(result.ok).toBe(true);
      expect(result.status).toBe("NEW");
    });

    it("sCode non-zero is treated as REJECTED", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitFailedResponse("51000", "Insufficient balance"));

      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
      expect(result.error).toContain("sCode=51000");
    });

    it("empty submitted data triggers error", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue({
        ok: true,
        body: { code: "0", msg: "", data: [] },
      });

      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
      expect(result.error).toContain("okx_empty_submit_response");
    });

    it("safeFetch network error", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSafeFetchError("network timeout"));

      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
      expect(result.error).toContain("network timeout");
    });

    it("safeFetch throws exception", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockRejectedValue(new Error("connection reset"));

      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
      expect(result.error).toContain("connection reset");
    });

    it("returns dryRun without calling signedPost", async () => {
      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: true });
      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.status).toBe("NEW");
      expect(result.raw).toEqual({ dryRun: true });
    });

    it("requires explicitConfirm for real execution", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      const result = await adapter.submitOrderLeg(spotBuyLeg, { dryRun: false, explicitConfirm: "WRONG" });
      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("explicit_confirm");
    });
  });

  describe("submitOrderLeg - perp_short (永续做空)", () => {
    it("sends correct OKX POST body for perp_short", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      await adapter.submitOrderLeg(perpShortLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
      expect(body.instId).toBe("BTC-USDT-SWAP");
      expect(body.tdMode).toBe("isolated");
      expect(body.side).toBe("sell");
      expect(body.posSide).toBe("short");
      expect(body.ordType).toBe("market");
      expect(body.sz).toBe("0.001");
      expect(body.szType).toBeUndefined();
    });

    it("perp_short safeFetch error", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_ORDER_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSafeFetchError("rate limit"));

      const result = await adapter.submitOrderLeg(perpShortLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
    });
  });

  describe("submitOrderLeg - perp_buy_close (永续平空)", () => {
    it("sends correct OKX POST body for perp_buy_close", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      await adapter.submitOrderLeg(perpBuyCloseLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });

      const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
      expect(body.instId).toBe("BTC-USDT-SWAP");
      expect(body.tdMode).toBe("isolated");
      expect(body.side).toBe("buy");
      expect(body.posSide).toBe("short");
      expect(body.ordType).toBe("market");
    });

    it("perp_buy_close env disabled blocks", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      const result = await adapter.submitOrderLeg(perpBuyCloseLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("real_close_execution_env_disabled");
    });
  });

  describe("submitOrderLeg - spot_sell (现货卖出平多)", () => {
    it("sends correct OKX POST body for spot_sell", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1", V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      await adapter.submitOrderLeg(spotSellLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });

      const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
      expect(body.instId).toBe("BTC-USDT");
      expect(body.tdMode).toBe("cash");
      expect(body.side).toBe("sell");
      expect(body.ordType).toBe("market");
      expect(body.szType).toBe("base_ccy");
    });

    it("spot_sell env disabled blocks", async () => {
      resetRuntimeConfig({ V121_ENABLE_REAL_INTERNAL_TRANSFER: "1" });
      mockSafeFetch.mockResolvedValue(makeSubmitOkResponse());

      const result = await adapter.submitOrderLeg(spotSellLeg, { dryRun: false, explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION" });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("real_close_execution_env_disabled");
    });
  });

  describe("submitOrderLeg - edge cases", () => {
    it("rejects unsupported exchange", async () => {
      const result = await adapter.submitOrderLeg(
        { ...spotBuyLeg, exchange: "htx" },
        { dryRun: true },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("exchange_not_supported");
    });

    it("rejects non-market order", async () => {
      const result = await adapter.submitOrderLeg(
        { ...spotBuyLeg, type: "LIMIT" as any },
        { dryRun: true },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("only_market_supported");
    });

    it("rejects unsupported role", async () => {
      const result = await adapter.submitOrderLeg(
        { ...spotBuyLeg, role: "invalid_role" as any },
        { dryRun: true },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("unsupported_order_leg_role");
    });
  });

  // ════════════════════════════════════════════════════════════
  // validateOrderPlan
  // ════════════════════════════════════════════════════════════

  describe("validateOrderPlan", () => {
    it("returns ok with precheck call for valid plan", async () => {
      mockSafeFetch.mockResolvedValue(makePrecheckOkResponse());

      const result = await adapter.validateOrderPlan(validPlan);

      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockSafeFetch.mock.calls[0];
      expect(callArgs[0]).toContain("/api/v5/trade/order-precheck");
      const body = JSON.parse(callArgs[1].body);
      expect(body.instId).toBe("BTC-USDT");
      expect(body.tdMode).toBe("cash");
      expect(body.side).toBe("buy");
    });

    it("blocks non-validated plan", async () => {
      const result = await adapter.validateOrderPlan({ ...validPlan, status: "blocked" });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("status is");
    });

    it("blocks plan missing spotLeg", async () => {
      const result = await adapter.validateOrderPlan({ ...validPlan, spotLeg: undefined as any });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("spotLeg");
    });

    it("blocks plan missing perpLeg", async () => {
      const result = await adapter.validateOrderPlan({ ...validPlan, perpLeg: undefined as any });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("perpLeg");
    });

    it("blocks plan with negative spot notional", async () => {
      const result = await adapter.validateOrderPlan({
        ...validPlan,
        spotLeg: { ...spotBuyLeg, quoteNotionalUsdt: -1 },
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("spotLeg");
    });

    it("blocks plan with negative perp quantity", async () => {
      const result = await adapter.validateOrderPlan({
        ...validPlan,
        perpLeg: { ...perpShortLeg, quantity: -1 },
      });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("perpLeg");
    });

    it("warns when perp notional below minNotional", async () => {
      mockSafeFetch.mockResolvedValue(makePrecheckOkResponse());
      const result = await adapter.validateOrderPlan({
        ...validPlan,
        perpLeg: { ...perpShortLeg, quoteNotionalUsdt: 3, constraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 } },
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w: string) => w.includes("minNotional"))).toBe(true);
    });

    it("precheck fails and marks plan blocked", async () => {
      mockSafeFetch.mockResolvedValue(makePrecheckFailResponse());

      const result = await adapter.validateOrderPlan(validPlan);

      expect(result.ok).toBe(false);
      expect(result.blockers.some((b: string) => b.includes("order-precheck"))).toBe(true);
    });

    it("precheck throws exception and marks plan blocked", async () => {
      mockSafeFetch.mockRejectedValue(new Error("timeout"));

      const result = await adapter.validateOrderPlan(validPlan);

      expect(result.ok).toBe(false);
      expect(result.blockers.some((b: string) => b.includes("order-precheck"))).toBe(true);
      expect(result.raw).toBeDefined();
    });

    it("blocks non-okx exchange", async () => {
      const result = await adapter.validateOrderPlan({ ...validPlan, exchange: "binance" });
      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain("only supports okx");
    });

    it("blocks perp clientOrderId > 36 chars", async () => {
      mockSafeFetch.mockResolvedValue(makePrecheckOkResponse());
      const result = await adapter.validateOrderPlan({
        ...validPlan,
        perpLeg: { ...perpShortLeg, clientOrderId: "a".repeat(37) },
      });
      expect(result.ok).toBe(false);
      expect(result.blockers.some((b: string) => b.includes("clientOrderId"))).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════
  // fetchOrderByClientOrderId
  // ════════════════════════════════════════════════════════════

  describe("fetchOrderByClientOrderId", () => {
    it("returns NEW status for live order (spot buy role)", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("live"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("NEW");
    });

    it("returns FILLED status for filled order", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("filled"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("FILLED");
      expect(result.exchangeOrderId).toBe("mock-ord");
    });

    it("returns PARTIALLY_FILLED status", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("partially_filled"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("PARTIALLY_FILLED");
    });

    it("returns CANCELED status", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("canceled"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("CANCELED");
    });

    it("returns REJECTED status for failed order", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("failed"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("REJECTED");
    });

    it("returns UNKNOWN for unrecognized state", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("moo"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "mock-cl",
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("UNKNOWN");
    });

    it("maps sell-side order to correct role (perp_short for perp)", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponseSell("filled"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "perp", clientOrderId: "mock-cl",
      });
      expect(result.role).toBe("perp_short");
    });

    it("returns UNKNOWN when order not found", async () => {
      mockSafeFetch.mockResolvedValue({
        ok: true,
        body: { code: "0", msg: "", data: [] },
      });
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "nonexistent",
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("UNKNOWN");
      expect(result.error).toBe("order_not_found");
    });

    it("returns UNKNOWN on safeFetch error", async () => {
      mockSafeFetch.mockResolvedValue(makeSafeFetchError("network error"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "perp", clientOrderId: "err",
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("UNKNOWN");
    });

    it("returns UNKNOWN on safeFetch exception", async () => {
      mockSafeFetch.mockRejectedValue(new Error("unexpected"));
      const result = await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "spot", clientOrderId: "boom",
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("UNKNOWN");
      expect(result.error).toBe("unexpected");
    });

    it("uses correct instId for perp query", async () => {
      mockSafeFetch.mockResolvedValue(makeOrderQueryResponse("live"));
      await adapter.fetchOrderByClientOrderId({
        symbol: "BTC/USDT", market: "perp", clientOrderId: "mock-cl",
      });
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const url = mockSafeFetch.mock.calls[0][0];
      expect(url).toContain("BTC-USDT-SWAP");
    });
  });

  // ════════════════════════════════════════════════════════════
  // transferInternal
  // ════════════════════════════════════════════════════════════

  describe("transferInternal", () => {
    it("returns ok for same-account transfer (unified account)", async () => {
      const result = await adapter.transferInternal({
        exchange: "okx", asset: "USDT",
        fromAccount: "spot", toAccount: "perp",
        amountUsdt: 50, reason: "test",
        idempotencyKey: "ik-test",
        dryRun: false,
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("submitted");
      expect(result.warnings).toContain("okx_unified_account_no_real_transfer_needed");
    });

    it("returns dryRun without env gate", async () => {
      const result = await adapter.transferInternal({
        exchange: "okx", asset: "USDT",
        fromAccount: "spot", toAccount: "perp",
        amountUsdt: 50, reason: "test",
        idempotencyKey: "ik-dryrun",
        dryRun: true,
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe("dry_run");
      expect(result.warnings).toContain("dry_run_no_real_transfer");
    });

    it("blocks exchange mismatch", async () => {
      const result = await adapter.transferInternal({
        exchange: "binance", asset: "USDT",
        fromAccount: "spot", toAccount: "perp",
        amountUsdt: 50, reason: "test",
        idempotencyKey: "ik-test",
        dryRun: false,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("exchange_mismatch");
    });

    it("blocks same-account transfer", async () => {
      const result = await adapter.transferInternal({
        exchange: "okx", asset: "USDT",
        fromAccount: "spot", toAccount: "spot",
        amountUsdt: 50, reason: "test",
        idempotencyKey: "ik-test",
        dryRun: false,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("same_account");
    });

    it("blocks non-USDT asset", async () => {
      const result = await adapter.transferInternal({
        exchange: "okx", asset: "BTC",
        fromAccount: "spot", toAccount: "perp",
        amountUsdt: 0.001, reason: "test",
        idempotencyKey: "ik-btc",
        dryRun: false,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("only_usdt_supported");
    });

    it("blocks when V121_ENABLE_REAL_INTERNAL_TRANSFER is not 1", async () => {
      resetRuntimeConfig({});
      const result = await adapter.transferInternal({
        exchange: "okx", asset: "USDT",
        fromAccount: "spot", toAccount: "perp",
        amountUsdt: 50, reason: "test",
        idempotencyKey: "ik-env",
        dryRun: false,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("real_internal_transfer_env_disabled");
    });
  });

  // ════════════════════════════════════════════════════════════
  // healthCheck
  // ════════════════════════════════════════════════════════════

  describe("healthCheck", () => {
    it("returns true when OKX public time responds with code 0", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ code: "0" }),
      });
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
      global.fetch = origFetch;
    });

    it("returns false on HTTP error (non-200)", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
      global.fetch = origFetch;
    });

    it("returns false on non-0 response code", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ code: "1", msg: "system maintenance" }),
      });
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
      global.fetch = origFetch;
    });

    it("returns false on unexpected response format", async () => {
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({}),
      });
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
      global.fetch = origFetch;
    });
  });
});
