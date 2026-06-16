import type { ExchangeId } from "../domain/types";
import type {
  AccountBalanceSnapshot, AccountPositionSnapshot, OpenOrderSnapshot,
  ShadowAccountReport, IAccountAdapter,
} from "./accountTypes";

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
 * Mock 账户适配器 — 开发和测试用。
 * TODO: M8+ 替换为真实只读 API 调用（Binance GET /sapi/v1/account, OKX GET /api/v5/account/balance 等）
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

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    return [];
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    return [];
  }

  async healthCheck(): Promise<boolean> {
    return isApiKeyConfigured(this.exchangeId);
  }
}

function createAdapter(exchange: ExchangeId): IAccountAdapter {
  return new MockAccountAdapter(exchange);
}

/**
 * 获取 SHADOW 账户报告 — 不会修改账户。
 */
export async function getShadowReport(): Promise<ShadowAccountReport> {
  const configured = getConfiguredExchanges().filter(e => e.configured);
  const warnings: string[] = [];

  if (configured.length === 0) {
    warnings.push("未检测到任何交易所的 API Key。请在 .env.local 中配置 BINANCE_API_KEY / OKX_API_KEY / HTX_API_KEY 后再试。");
  }

  const allBalances: AccountBalanceSnapshot[] = [];
  const allPositions: AccountPositionSnapshot[] = [];
  const allOrders: OpenOrderSnapshot[] = [];

  for (const { exchange } of configured) {
    try {
      const adapter = createAdapter(exchange);
      const [balances, positions, orders] = await Promise.all([
        adapter.fetchBalances(), adapter.fetchPositions(), adapter.fetchOpenOrders(),
      ]);
      allBalances.push(...balances);
      allPositions.push(...positions);
      allOrders.push(...orders);
    } catch (err) {
      warnings.push(`${exchange} 读取失败: ${(err as Error).message}`);
    }
  }

  // 未配置的交易所使用开发模拟数据并告警
  for (const { exchange, configured: cfg } of getConfiguredExchanges()) {
    if (!cfg) {
      warnings.push(`${exchange} 未配置 API Key — 使用开发模拟数据，不会下单`);
      try {
        const adapter = createAdapter(exchange);
        allBalances.push(...await adapter.fetchBalances());
      } catch { /* ignore dev mock errors */ }
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
  };
}
