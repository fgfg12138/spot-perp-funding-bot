import type { ExchangeId } from "../domain/types";
import type {
  AccountBalanceSnapshot, AccountPositionSnapshot, OpenOrderSnapshot,
  ShadowAccountReport, IAccountAdapter,
} from "./accountTypes";
import { createAccountAdapter, type DataSource } from "./adapters/accountAdapterFactory";

/**
 * 检查环境变量中是否配置了对应交易所的 API Key。
 * 只返回 true/false，不泄露 key 内容。
 */
export function isApiKeyConfigured(exchange: ExchangeId): boolean {
  const prefix = exchange.toUpperCase();
  const key = process.env[`${prefix}_API_KEY`];
  const secret = process.env[`${prefix}_API_SECRET`];
  const hasKey = !!key && key.length > 0;
  const hasSecret = !!secret && secret.length > 0;

  if (exchange === "okx") {
    const passphrase = process.env[`${prefix}_PASSPHRASE`];
    return hasKey && hasSecret && !!passphrase && passphrase.length > 0;
  }
  return hasKey && hasSecret;
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
  const useMock = process.env.V121_SHADOW_USE_MOCK === "1";

  if (!anyConfigured && !useMock) {
    warnings.push("未检测到任何交易所的 API Key。请在 .env.local 中配置后重启服务。如需使用模拟数据，设置 V121_SHADOW_USE_MOCK=1。");
  }

  for (const { exchange } of configured) {
    const { adapter, dataSource } = createAccountAdapter(exchange);
    dataSources[exchange] = dataSource;

    if (dataSource === "real") {
      try {
        const [balances, positions, orders] = await Promise.all([
          adapter.fetchBalances().catch(() => [] as AccountBalanceSnapshot[]),
          adapter.fetchPositions().catch(() => [] as AccountPositionSnapshot[]),
          adapter.fetchOpenOrders().catch(() => [] as OpenOrderSnapshot[]),
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
