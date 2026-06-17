import type { StrategyMode, ExchangeId } from "../domain/types";
import { MAINNET_TINY_DEFAULT_LIMITS } from "../config/strategyConfig";
import { getKillSwitch } from "../risk/killSwitch";
import { isSmallCoin } from "../market/contractSpec";
import { getPersistenceMode } from "../persistence/persistenceMode";

export interface MainnetTinyGateStatus {
  mode: string;
  allowed: boolean;
  missing: string[];
  warnings: string[];
  killSwitch: string;
  persistenceMode: string;
  limits: typeof MAINNET_TINY_DEFAULT_LIMITS;
}

/**
 * 检查 MAINNET_TINY 环境门。
 * 必须所有条件满足才 allowed=true。
 * 即使 allowed，本阶段(M9.0)也不真实下单。
 */
export function checkMainnetTinyGate(): MainnetTinyGateStatus {
  const mode = process.env.V121_MODE ?? "";
  const tinyEnabled = process.env.V121_MAINNET_TINY_ENABLED;
  const riskConfirmed = process.env.V121_CONFIRM_MAINNET_TINY_RISK;
  const liveEnabled = process.env.V121_LIVE_ENABLED;
  const ks = getKillSwitch();
  const persMode = getPersistenceMode();

  const missing: string[] = [];
  const warnings: string[] = [];

  if (mode !== "MAINNET_TINY") missing.push("V121_MODE 未设置为 MAINNET_TINY");
  if (tinyEnabled !== "true") missing.push("V121_MAINNET_TINY_ENABLED 未设置为 true");
  if (riskConfirmed !== "I_UNDERSTAND") missing.push("V121_CONFIRM_MAINNET_TINY_RISK 未确认为 I_UNDERSTAND");
  if (liveEnabled === "true") warnings.push("V121_LIVE_ENABLED=true 与 MAINNET_TINY 不兼容，应为 false");
  if (ks !== "OFF") warnings.push(`Kill Switch 当前为 ${ks}，应设为 OFF`);
  if (persMode !== "sqlite-active") warnings.push(`持久化模式为 ${persMode}，MAINNET_TINY 需要 sqlite-active`);

  return {
    mode,
    allowed: missing.length === 0,
    missing,
    warnings,
    killSwitch: ks,
    persistenceMode: persMode,
    limits: { ...MAINNET_TINY_DEFAULT_LIMITS },
  };
}

/**
 * 验证订单意图是否在 MAINNET_TINY 限制内。
 * 只检查，不下单。
 */
export function validateOrderIntent(params: {
  symbol: string;
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
  notionalUsdt: number;
  totalExposureUsdt: number;
}): { allowed: boolean; blockedReasons: string[] } {
  const blocked: string[] = [];
  const limits = MAINNET_TINY_DEFAULT_LIMITS;

  if (params.notionalUsdt > limits.maxOrderNotionalUsdt) {
    blocked.push(`单笔 ${params.notionalUsdt} USDT > 上限 ${limits.maxOrderNotionalUsdt} USDT`);
  }
  if (params.totalExposureUsdt > limits.maxTotalExposureUsdt) {
    blocked.push(`总暴露 ${params.totalExposureUsdt} USDT > 上限 ${limits.maxTotalExposureUsdt} USDT`);
  }
  if (isSmallCoin(params.symbol)) {
    blocked.push(`小币种 ${params.symbol} 被禁止`);
  }
  if (params.spotExchange === "htx" || params.perpExchange === "htx") {
    blocked.push("HTX 被禁止");
  }
  if (params.spotExchange !== params.perpExchange) {
    blocked.push("跨所交易被禁止");
  }

  return { allowed: blocked.length === 0, blockedReasons: blocked };
}
