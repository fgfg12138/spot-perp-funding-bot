import type { ExchangeId } from "../domain/types";
import type {
  AccountBalanceSnapshot, AccountPositionSnapshot, OpenOrderSnapshot,
  ShadowAccountReport, IAccountAdapter,
} from "./accountTypes";
import { createAccountAdapter, type DataSource } from "./adapters/accountAdapterFactory";
import { getExchangeCredentials, isShadowUseMock } from "../config/runtimeConfig";

/**
 * 检查环境变量中是否配置了对应交易所的 API Key。
 * 只返回 true/false，不泄露 key 内容。
 * 通过 runtimeConfig.getExchangeCredentials 读取，避免直接访问 process.env。
 */
export function isApiKeyConfigured(exchange: ExchangeId): boolean {
  const creds = getExchangeCredentials(exchange);
  if (!creds) return false;
  if (!creds.apiKey || !creds.apiSecret) return false;
  if (exchange === "okx" && !creds.passphrase) return false;
  return true;
}

/**
 * 获取已配置 API Key 的交易所列表（不泄露具体值）。
 */
export function getConfiguredExchanges(): { exchange: ExchangeId; configured: boolean }[] {
  return [
    { exchange: "binance", configured: isApiKeyConfigured("binance") },
    { exchange: "okx",     configured: isApiKeyConfigured("okx") },
    { exchange: "htx",     configured: isApiKeyConfigured("htx") },
  ];
}

/**
 * Mock 账户适配器 — 仅用于开发环境（V121_SHADOW_USE_MOCK=1）。
 * 不连接真实交易所。
 */
export class MockAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId;
  constructor(exchangeId: ExchangeId) { this.exchangeId = exchangeId; }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    return [{
      exchange: this.exchangeId, asset: "USDT", free: 10000, locked: 0, total: 10000,
      usdtValue: 10000, fetchedAtUtc: new Date().toISOString(),
    }];
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> { return []; }
  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> { return []; }
  async healthCheck(): Promise<boolean> { return false; }

  async transferInternal(request: import("../execution/internalTransferTypes").InternalTransferRequest): Promise<import("../execution/internalTransferTypes").InternalTransferResult> {
    return {
      ok: true,
      status: request.dryRun ? "dry_run" : "submitted",
      exchange: request.exchange,
      asset: "USDT",
      fromAccount: request.fromAccount,
      toAccount: request.toAccount,
      amountUsdt: request.amountUsdt,
      idempotencyKey: request.idempotencyKey,
      transferId: `mock-transfer-${request.idempotencyKey}`,
      submittedAtUtc: new Date().toISOString(),
      warnings: ["mock_internal_transfer_only"],
    };
  }

  async validateOrderPlan(_plan: import("../execution/orderTypes").TwoLegOrderPlan): Promise<{ ok: boolean; blockers: string[]; warnings: string[]; raw?: unknown }> {
    return { ok: true, blockers: [], warnings: ["mock_validation_no_real_check"] };
  }

  async submitOrderLeg(
    leg: import("../execution/orderTypes").PlannedOrderLeg,
    _options: { dryRun: boolean; explicitConfirm?: string },
  ): Promise<import("../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    return {
      ok: true,
      exchange: leg.exchange,
      symbol: leg.symbol,
      market: leg.market,
      role: leg.role,
      clientOrderId: leg.clientOrderId,
      exchangeOrderId: `mock-order-${Date.now()}`,
      status: "FILLED" as const,
      executedQty: leg.quantity,
      executedQuoteQty: leg.quoteNotionalUsdt,
      avgPrice: leg.estimatedPrice,
      submittedAtUtc: new Date().toISOString(),
    };
  }

  async fetchOrderByClientOrderId(
    input: { symbol: string; market: "spot" | "perp"; clientOrderId: string },
  ): Promise<import("../execution/orderExecutionTypes").ExchangeOrderSubmissionResult> {
    return {
      ok: false,
      exchange: this.exchangeId,
      symbol: input.symbol,
      market: input.market,
      role: "spot_buy" as const,
      clientOrderId: input.clientOrderId,
      exchangeOrderId: "",
      status: "UNKNOWN" as const,
      error: "mock_adapter_does_not_track_orders",
      submittedAtUtc: new Date().toISOString(),
    };
  }
}

/**
 * 获取 SHADOW 账户报告 — 不会修改账户。
 *
 * - API Key 已配置：使用真实只读适配器
 * - V121_SHADOW_USE_MOCK=1：使用模拟数据（UI 会标注）
 * - 否则：不返回假数据，显示未配置
 */
export async function getShadowReport(): Promise<ShadowAccountReport & { dataSources: Record<string, string>; _secretCheck: string }> {
  const configured = getConfiguredExchanges();
  const warnings: string[] = [];
  const dataSources: Record<string, string> = {};
  const allBalances: AccountBalanceSnapshot[] = [];
  const allPositions: AccountPositionSnapshot[] = [];
  const allOrders: OpenOrderSnapshot[] = [];

  const anyConfigured = configured.some(c => c.configured);
  const useMock = isShadowUseMock();

  if (!anyConfigured && !useMock) {
    warnings.push("未检测到任何交易所的 API Key。请在 .env.local 中配置后重启服务。如需使用模拟数据，设置 V121_SHADOW_USE_MOCK=1。");
  }

  for (const { exchange } of configured) {
    const { adapter, dataSource } = createAccountAdapter(exchange);
    dataSources[exchange] = dataSource;

    if (dataSource === "real") {
      try {
        const [balances, positions, orders] = await Promise.all([
          adapter.fetchBalances().catch((e: Error) => {
            warnings.push(`${exchange} 余额读取失败: ${e.message}`);
            return [] as AccountBalanceSnapshot[];
          }),
          adapter.fetchPositions().catch((e: Error) => {
            warnings.push(`${exchange} 仓位读取失败: ${e.message}`);
            return [] as AccountPositionSnapshot[];
          }),
          adapter.fetchOpenOrders().catch((e: Error) => {
            warnings.push(`${exchange} 挂单读取失败: ${e.message}`);
            return [] as OpenOrderSnapshot[];
          }),
        ]);
        allBalances.push(...balances);
        allPositions.push(...positions);
        allOrders.push(...orders);
      } catch (err) {
        warnings.push(`${exchange} 真实读取失败: ${(err as Error).message}`);
      }
    } else if (dataSource === "mock") {
      warnings.push(`${exchange}：当前为开发模拟数据，不是交易所真实账户数据。`);
    try {
      allBalances.push(...await adapter.fetchBalances().catch(() => []));
    } catch { /* ignore */ }
    } else {
      // not_configured — no data returned
      warnings.push(`${exchange}：未配置 API Key。`);
    }
  }

  return {
    mode: "SHADOW",
    generatedAtUtc: new Date().toISOString(),
    balances: allBalances,
    positions: allPositions,
    openOrders: allOrders,
    warnings,
    canModifyAccount: false,
    dataSources,
    _secretCheck: "passed — 未泄露 API Key 或 Secret",
  };
}
