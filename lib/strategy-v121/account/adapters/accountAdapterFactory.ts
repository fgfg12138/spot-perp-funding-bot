import type { ExchangeId } from "../../domain/types";
import type { IAccountAdapter } from "../accountTypes";
import { isApiKeyConfigured } from "../shadowAccountService";
import { BinanceAccountAdapter } from "./binanceAccountAdapter";
import { OkxAccountAdapter } from "./okxAccountAdapter";
import { HtxAccountAdapter } from "./htxAccountAdapter";
import { MockAccountAdapter } from "../shadowAccountService";

export type DataSource = "real" | "mock" | "not_configured";

/**
 * 创建账户适配器。
 *
 * 优先级：
 * 1. V121_SHADOW_USE_MOCK=1 → 模拟数据（开发用，UI 会标注）
 * 2. 交易所 API Key 已配置 → 真实只读适配器
 * 3. 否则 → not_configured（不返回假数据）
 */
export function createAccountAdapter(
  exchange: ExchangeId,
): { adapter: IAccountAdapter; dataSource: DataSource } {
  const useMock = process.env.V121_SHADOW_USE_MOCK === "1";

  if (useMock) {
    return { adapter: new MockAccountAdapter(exchange), dataSource: "mock" };
  }

  if (isApiKeyConfigured(exchange)) {
    switch (exchange) {
      case "binance": return { adapter: new BinanceAccountAdapter(), dataSource: "real" };
      case "okx":     return { adapter: new OkxAccountAdapter(), dataSource: "real" };
      case "htx":     return { adapter: new HtxAccountAdapter(), dataSource: "real" };
    }
  }

  return { adapter: new MockAccountAdapter(exchange), dataSource: "not_configured" };
}

/**
 * 中文化数据源标签
 */
export function dataSourceLabel(ds: DataSource): string {
  switch (ds) {
    case "real":            return "真实账户";
    case "mock":            return "开发模拟";
    case "not_configured":  return "未配置";
  }
}
