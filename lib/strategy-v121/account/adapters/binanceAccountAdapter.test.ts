/**
 * BinanceAccountAdapter 平仓腿测试 — 验证 Hedge Mode / One-way Mode 参数分支。
 *
 * 重点：Binance USDⓈ-M 规则
 * - Hedge Mode: positionSide=SHORT 必须发送，reduceOnly 不能发送
 * - One-way Mode: reduceOnly=true 可以发送，positionSide 不能发送
 *
 * PlannedCloseOrderLeg.reduceOnly / positionSide 是内部语义标记，
 * adapter 发请求时按持仓模式转换，不原样塞给交易所。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetRuntimeConfig } from "../../config/runtimeConfig";

// 捕获 signedPost 发出的实际参数（通过 mock safeFetch 的 URL query string 解析）
const mockSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("./safeFetch", () => ({
  safeFetch: mockSafeFetch,
}));

vi.mock("./accountSigning", () => ({
  binanceSign: (qs: string) => ({ signature: "mock-sig", apiKey: "mock-key" }),
  utcTimestampMs: () => 1700000000000,
}));

import { BinanceAccountAdapter } from "./binanceAccountAdapter";
import type { PlannedOrderLeg } from "../../execution/orderTypes";

// ── 测试用 leg fixtures ──────────────────────────────────────
const perpBuyCloseLeg: PlannedOrderLeg = {
  role: "perp_buy_close",
  exchange: "binance",
  symbol: "BTC/USDT",
  market: "perp",
  side: "BUY",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60000,
  clientOrderId: "v121_perp_close_test_123",
  reduceOnly: true,
  positionSide: "SHORT",
  constraints: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
};

const spotSellLeg: PlannedOrderLeg = {
  role: "spot_sell",
  exchange: "binance",
  symbol: "BTC/USDT",
  market: "spot",
  side: "SELL",
  type: "MARKET",
  quantity: 0.001,
  quoteNotionalUsdt: 60,
  estimatedPrice: 60000,
  clientOrderId: "v121_spot_close_test_123",
  reduceOnly: false,
  constraints: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5 },
};

/** 从 safeFetch 调用的 URL 中解析 query 参数。 */
function extractParams(url: string): Record<string, string> {
  const queryStr = url.split("?")[1] ?? "";
  const params: Record<string, string> = {};
  for (const pair of queryStr.split("&")) {
    const [k, v] = pair.split("=");
    if (k && k !== "signature") params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return params;
}

function mockFuturesResponse(status: string = "FILLED") {
  return {
    ok: true,
    status: 200,
    body: {
      orderId: 123456,
      status,
      executedQty: "0.001",
      cummulativeQuoteQty: "60",
      avgPrice: "60000",
    },
  };
}

function mockSpotResponse(status: string = "FILLED") {
  return {
    ok: true,
    status: 200,
    body: {
      orderId: 789012,
      status,
      executedQty: "0.001",
      cummulativeQuoteQty: "60",
      avgPrice: "60000",
      fills: [{ price: "60000", qty: "0.001" }],
    },
  };
}

describe("BinanceAccountAdapter close legs", () => {
  let adapter: BinanceAccountAdapter;

  beforeEach(() => {
    // mockReset 清除调用历史 + 实现 + 一次性队列，避免上个测试未消费的 mockResolvedValueOnce 泄漏
    mockSafeFetch.mockReset();
    adapter = new BinanceAccountAdapter();
    resetRuntimeConfig({ V121_ENABLE_REAL_CLOSE_EXECUTION: "1" });
  });

  afterEach(() => {
    resetRuntimeConfig({});
  });

  // ── getPositionMode ──────────────────────────────────────

  it("1. getPositionMode — Hedge Mode when dualSidePosition=true", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { dualSidePosition: true },
    });
    const mode = await adapter.getPositionMode();
    expect(mode).toBe("hedge");
  });

  it("2. getPositionMode — One-way Mode when dualSidePosition=false", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { dualSidePosition: false },
    });
    const mode = await adapter.getPositionMode();
    expect(mode).toBe("one_way");
  });

  it("3. getPositionMode — 查询失败默认 One-way（更安全）", async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 401, errorMessage: "auth error" });
    const mode = await adapter.getPositionMode();
    expect(mode).toBe("one_way");
  });

  // ── submitPerpBuyCloseMarket — Hedge Mode ────────────────

  it("4. Hedge Mode close short — 发送 positionSide=SHORT，不发 reduceOnly", async () => {
    // 第一次调用：getPositionMode 查询
    mockSafeFetch.mockResolvedValueOnce({
      ok: true, status: 200, body: { dualSidePosition: true },
    });
    // 第二次调用：提交订单
    mockSafeFetch.mockResolvedValueOnce(mockFuturesResponse("FILLED"));

    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");
    expect(result.role).toBe("perp_buy_close");

    // 验证第二次调用（提交订单）的 URL 参数
    const submitCall = mockSafeFetch.mock.calls[1];
    const submitUrl = submitCall?.[0] as string;
    const params = extractParams(submitUrl);

    expect(params.side).toBe("BUY");
    expect(params.type).toBe("MARKET");
    expect(params.positionSide).toBe("SHORT");
    expect(params.reduceOnly).toBeUndefined();
    expect(params.quantity).toBe("0.001");
  });

  // ── submitPerpBuyCloseMarket — One-way Mode ──────────────

  it("5. One-way Mode close short — 发送 reduceOnly=true，不发 positionSide", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: true, status: 200, body: { dualSidePosition: false },
    });
    mockSafeFetch.mockResolvedValueOnce(mockFuturesResponse("FILLED"));

    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");

    const submitCall = mockSafeFetch.mock.calls[1];
    const submitUrl = submitCall?.[0] as string;
    const params = extractParams(submitUrl);

    expect(params.side).toBe("BUY");
    expect(params.type).toBe("MARKET");
    expect(params.reduceOnly).toBe("true");
    expect(params.positionSide).toBeUndefined();
    expect(params.quantity).toBe("0.001");
  });

  // ── submitSpotSellMarket ─────────────────────────────────

  it("6. spot SELL — side=SELL, quantity 模式（不是 quoteOrderQty）", async () => {
    mockSafeFetch.mockResolvedValueOnce(mockSpotResponse("FILLED"));

    const result = await adapter.submitOrderLeg(spotSellLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");
    expect(result.role).toBe("spot_sell");

    const submitCall = mockSafeFetch.mock.calls[0];
    const submitUrl = submitCall?.[0] as string;
    const params = extractParams(submitUrl);

    expect(params.side).toBe("SELL");
    expect(params.type).toBe("MARKET");
    expect(params.quantity).toBe("0.001");
    expect(params.quoteOrderQty).toBeUndefined();
  });

  // ── 独立门控验证 ─────────────────────────────────────────

  it("7. close leg 用开仓确认串 → explicit_confirm_required", async () => {
    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER", // 开仓确认串，不应用于平仓
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("REJECTED");
    expect(result.error).toBe("explicit_confirm_required");
  });

  it("8. close env 未开 → real_close_execution_env_disabled", async () => {
    resetRuntimeConfig({});
    mockSafeFetch.mockResolvedValueOnce({
      ok: true, status: 200, body: { dualSidePosition: false },
    });
    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("REJECTED");
    expect(result.error).toBe("real_close_execution_env_disabled");
  });

  // ── dryRun 不触发真实提交 ────────────────────────────────

  it("9. dryRun close leg — 不调用真实 API，返回 NEW", async () => {
    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("NEW");
    expect(result.role).toBe("perp_buy_close");
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  // ── REJECTED 处理 ────────────────────────────────────────

  it("10. perp close REJECTED → ok=false, status=REJECTED", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: true, status: 200, body: { dualSidePosition: false },
    });
    mockSafeFetch.mockResolvedValueOnce({
      ok: false, status: 400, errorMessage: "insufficient margin",
      body: { code: -2010, msg: "insufficient margin" },
    });

    const result = await adapter.submitOrderLeg(perpBuyCloseLeg, {
      dryRun: false,
      explicitConfirm: "EXECUTE_REAL_CLOSE_POSITION",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("REJECTED");
    expect(result.role).toBe("perp_buy_close");
  });
});
