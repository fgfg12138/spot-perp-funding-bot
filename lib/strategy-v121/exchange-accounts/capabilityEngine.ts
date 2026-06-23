/**
 * CapabilityEngine — 根据探测出的权限能力决定套利模式可用性。
 *
 * 规则（V1.2.1 安全策略）：
 *  - sameExchangeArbEnabled 需要：tradeSpot + tradePerp + positions + fundingRate
 *  - crossExchangeArbEnabled 默认禁用（M9/M10 策略明确禁止跨交易所）
 *  - HTX 账户的 sameExchangeArbEnabled 始终为 false（observe-only 策略）
 *  - 交易类权限必须人工确认或通过安全探测后才能启用
 *
 * 输出：在传入的 capability 基础上补充 sameExchangeArbEnabled / crossExchangeArbEnabled。
 */

import type { ExchangeCapability } from "./types";
import type { ExchangeId } from "../domain/types";

// ─── 决策结果 ───────────────────────────────────────

export interface CapabilityDecision {
  sameExchangeArbEnabled: boolean;
  crossExchangeArbEnabled: boolean;
  reasons: string[];
  warnings: string[];
}

// ─── 默认策略开关 ───────────────────────────────────

/** HTX 在 V1.2.1 中为 observe-only，不可用于套利执行。 */
const HTX_OBSERVE_ONLY = true;

/** 跨交易所套利在 M9/M10 阶段默认禁用。 */
const CROSS_EXCHANGE_DISABLED = true;

// ─── 核心决策 ───────────────────────────────────────

/**
 * 根据能力推断同交易所套利是否可用。
 *
 * 必要条件：
 *  1. exchange !== "htx"（HTX observe-only 策略）
 *  2. tradeSpot = true
 *  3. tradePerp = true
 *  4. positions = true（能读取持仓才能监控）
 *  5. fundingRate = true（能读取资金费率才能判断机会）
 *  6. readBalance = true（能读取余额才能风控）
 */
export function decideArbCapability(cap: ExchangeCapability): CapabilityDecision {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ─── 同交易所套利 ─────────────────────────────────
  let sameExchange = true;

  if (HTX_OBSERVE_ONLY && cap.exchange === ("htx" as ExchangeId)) {
    sameExchange = false;
    reasons.push("HTX 在 V1.2.1 中为 observe-only，不可用于套利执行");
  }

  if (!cap.tradeSpot) {
    sameExchange = false;
    reasons.push("缺少 tradeSpot 权限");
  }

  if (!cap.tradePerp) {
    sameExchange = false;
    reasons.push("缺少 tradePerp 权限");
  }

  if (!cap.positions) {
    sameExchange = false;
    reasons.push("缺少 positions 读取权限");
  }

  if (!cap.fundingRate) {
    sameExchange = false;
    reasons.push("缺少 fundingRate 读取权限");
  }

  if (!cap.readBalance) {
    sameExchange = false;
    reasons.push("缺少 readBalance 权限（风控必需）");
  }

  // ─── 跨交易所套利 ─────────────────────────────────
  let crossExchange = false;
  if (CROSS_EXCHANGE_DISABLED) {
    reasons.push("跨交易所套利在 M9/M10 阶段默认禁用");
  } else {
    // 如果未来启用，需要额外的权限检查
    crossExchange = sameExchange && cap.internalTransfer;
    if (!crossExchange && sameExchange) {
      warnings.push("跨交易所套利需要 internalTransfer 权限");
    }
  }

  // ─── 额外警告 ─────────────────────────────────────
  if (cap.lastError) {
    warnings.push(`上次探测存在错误: ${cap.lastError}`);
  }

  if (sameExchange && !cap.orders) {
    warnings.push("缺少 orders 读取权限，可能影响订单状态监控");
  }

  return {
    sameExchangeArbEnabled: sameExchange,
    crossExchangeArbEnabled: crossExchange,
    reasons,
    warnings,
  };
}

/**
 * 将决策应用到 capability 对象，返回更新后的副本。
 */
export function applyArbDecision(
  cap: ExchangeCapability,
): ExchangeCapability & { decision: CapabilityDecision } {
  const decision = decideArbCapability(cap);
  return {
    ...cap,
    sameExchangeArbEnabled: decision.sameExchangeArbEnabled,
    crossExchangeArbEnabled: decision.crossExchangeArbEnabled,
    decision,
  };
}

/**
 * 获取某交易所下所有可用账户（同交易所套利 enabled）。
 */
export function filterArbCapableAccounts(
  caps: ExchangeCapability[],
): ExchangeCapability[] {
  return caps.filter(c => decideArbCapability(c).sameExchangeArbEnabled);
}
