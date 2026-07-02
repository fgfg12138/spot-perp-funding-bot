/**
 * 资金规划与风控模块
 *
 * 核心思路：
 * - 不要把 100% 资金都拿去做"现货 50% + 空单保证金 50%"
 * - 保证金缓冲必须提前放在做空合约所在交易所，不能指望临时划转
 * - 真正的爆仓风险不在"方向没对冲"，而在合约账户现金流断了
 *
 * 资金分配方案（按总资金 100%）：
 *
 * 同所标准版（推荐）:
 *   30% 买现货
 *   30% 做空同等名义永续
 *   30% 放合约账户作为额外保证金
 *   10% 备用 USDT
 *
 * 跨所保守版:
 *   25% A所买现货
 *   25% B所做空永续
 *   35% B所合约保证金缓冲
 *   15% 备用（至少一半放 B所）
 *
 * 极端保守版:
 *   20% 买现货
 *   20% 做空永续
 *   50% 合约保证金
 *   10% 备用
 */

import type { CapitalPlan, CapitalPlanType, PositionRiskStatus } from "../domain/types";
import { CAPITAL_PLANS, LIQUIDATION_THRESHOLDS, POSITION_LIMITS } from "../domain/constants";
import { mul, div, add, sub } from "../utils/decimalMath";

export interface CapitalPlanInput {
  /** 总资金 USDT */
  totalCapital: number;
  /** 方案类型 */
  planType: CapitalPlanType;
  /** 是否跨所 */
  isCrossExchange: boolean;
  /** 币种分类（用于确定单币上限） */
  symbolCategory: "core" | "opportunity" | "watch" | "meme";
}

/**
 * 计算资金分配方案
 */
export function computeCapitalPlan(input: CapitalPlanInput): CapitalPlan {
  const plan = input.isCrossExchange
    ? CAPITAL_PLANS.CROSS_EXCHANGE_CONSERVATIVE
    : CAPITAL_PLANS.SAME_EXCHANGE_STANDARD;

  const spotAmount = mul(input.totalCapital, plan.spotRatio);
  const shortNotionalAmount = mul(input.totalCapital, plan.shortNotionalRatio);
  const perpMarginBufferAmount = mul(input.totalCapital, plan.perpMarginBufferRatio);
  const reserveAmount = mul(input.totalCapital, plan.reserveRatio);
  const totalMarginAmount = add(shortNotionalAmount, perpMarginBufferAmount);

  // 可承受价格上涨幅度 = 合约账户总保证金 / 空单名义 - 1（粗略）
  // 实际要扣维持保证金等
  const tolerablePriceRise = shortNotionalAmount > 0
    ? sub(div(totalMarginAmount, shortNotionalAmount), 1)
    : Infinity;

  return {
    planType: input.planType,
    totalCapital: input.totalCapital,
    spotRatio: plan.spotRatio,
    shortNotionalRatio: plan.shortNotionalRatio,
    perpMarginBufferRatio: plan.perpMarginBufferRatio,
    reserveRatio: plan.reserveRatio,
    spotAmount,
    shortNotionalAmount,
    perpMarginBufferAmount,
    reserveAmount,
    totalMarginAmount,
    tolerablePriceRise: Math.max(0, tolerablePriceRise),
  };
}

/**
 * 带安全垫的版本——根据币种风险自动收紧
 */
export function computeCapitalPlanSafe(input: CapitalPlanInput): CapitalPlan {
  const plan = computeCapitalPlan(input);

  // 根据币种调整
  let riskMultiplier = 1.0;
  switch (input.symbolCategory) {
    case "watch":
    case "meme":
      riskMultiplier = 1.5;   // 额外加 50% 保证金
      break;
    case "opportunity":
      riskMultiplier = 1.2;   // 额外加 20%
      break;
    default:
      riskMultiplier = 1.0;
  }

  // 调整：增加保证金，减少现货和名义
  const adjustedMargin = Math.min(
    mul(plan.perpMarginBufferAmount, riskMultiplier),
    mul(plan.totalCapital, 0.65), // 保证金不超过总资金的 65%
  );

  const reducedNotional = div(plan.shortNotionalAmount, riskMultiplier);
  const freedCapital = sub(plan.shortNotionalAmount, reducedNotional);
  const additionalMargin = sub(adjustedMargin, plan.perpMarginBufferAmount);

  // 重新分配
  return {
    ...plan,
    spotAmount: plan.spotAmount - freedCapital,
    shortNotionalAmount: reducedNotional,
    perpMarginBufferAmount: adjustedMargin,
    reserveAmount: plan.reserveAmount + freedCapital,
    totalMarginAmount: reducedNotional + adjustedMargin,
    tolerablePriceRise: reducedNotional > 0
      ? Math.max(0, sub(div(add(reducedNotional, adjustedMargin), reducedNotional), 1))
      : Infinity,
  };
}

// ─── 单币仓位上限 ─────────────────────────────────────

export interface SymbolPositionLimit {
  /** 该币种最大名义金额（USDT） */
  maxNotional: number;
  /** 建议名义金额（USDT） */
  suggestedNotional: number;
  /** 最大占总资金比例 */
  maxPct: number;
}

/**
 * 计算单个币的仓位上限
 */
export function computeSymbolPositionLimit(
  totalCapital: number,
  category: "core" | "opportunity" | "watch" | "meme",
): SymbolPositionLimit {
  let maxPct: number;
  switch (category) {
    case "core":
      maxPct = POSITION_LIMITS.CORE_MAX_PCT;
      break;
    case "opportunity":
      maxPct = POSITION_LIMITS.OPPORTUNITY_MAX_PCT;
      break;
    case "watch":
    case "meme":
      maxPct = POSITION_LIMITS.WATCH_MAX_PCT;
      break;
    default:
      maxPct = 0.02;
  }

  const maxNotional = totalCapital * maxPct;
  return {
    maxNotional,
    suggestedNotional: maxNotional * 0.8, // 留 20% 余量
    maxPct,
  };
}

// ─── 强平距离监控 ─────────────────────────────────────

export interface LiquidationCheckInput {
  /** 标记价格 */
  markPrice: number;
  /** 开仓均价 */
  entryPrice: number;
  /** 杠杆倍数 */
  leverage: number;
  /** 合约账户保证金余额（USDT） */
  marginBalance: number;
  /** 当前持仓名义 USD */
  positionNotional: number;
  /** 是否小币/Meme */
  isSmallCap: boolean;
}

export interface LiquidationCheckResult {
  /** 估算强平价 */
  estimatedLiquidationPrice: number;
  /** 强平距离百分比（从当前到强平的变化百分比） */
  distancePct: number;
  /** 风险等级 */
  riskLevel: "safe" | "warning" | "danger" | "critical";
  /** 建议动作 */
  suggestedAction: "none" | "reduce" | "force_half" | "exit";
}

/**
 * 检查空单的强平距离
 *
 * 对于做空永续，价格上涨会导致浮亏。
 * 估算强平价 = entryPrice × (1 + marginBalance / positionNotional × leverage)
 * 但实际强平机制更复杂，此处做保守估算。
 */
export function checkLiquidationDistance(input: LiquidationCheckInput): LiquidationCheckResult {
  // 做空时价格上涨 x% 导致的浮亏比例 = x%
  // 当浮亏 >= 保证金/杠杆调整值时触发强平
  // 保守估算：强平价 = 入场价 × (1 + 保证金率 / 杠杆)
  const marginRatio = input.marginBalance / input.positionNotional;
  const estLiqPrice = input.entryPrice * (1 + marginRatio / input.leverage);

  // 距离当前价格的涨幅百分比
  const distancePct = input.markPrice > 0
    ? (estLiqPrice / input.markPrice) - 1
    : 0;

  const thresholds = input.isSmallCap
    ? {
        warning: LIQUIDATION_THRESHOLDS.WARNING_PCT_ALT,
        reduce: LIQUIDATION_THRESHOLDS.REDUCE_PCT_ALT,
        forceExit: LIQUIDATION_THRESHOLDS.FORCE_EXIT_PCT_ALT,
      }
    : {
        warning: LIQUIDATION_THRESHOLDS.WARNING_PCT,
        reduce: LIQUIDATION_THRESHOLDS.REDUCE_PCT,
        forceExit: LIQUIDATION_THRESHOLDS.FORCE_EXIT_PCT,
      };

  let riskLevel: "safe" | "warning" | "danger" | "critical";
  let suggestedAction: "none" | "reduce" | "force_half" | "exit";

  if (distancePct > thresholds.warning) {
    riskLevel = "safe";
    suggestedAction = "none";
  } else if (distancePct > thresholds.reduce) {
    riskLevel = "warning";
    suggestedAction = "reduce";
  } else if (distancePct > thresholds.forceExit) {
    riskLevel = "danger";
    suggestedAction = "force_half";
  } else {
    riskLevel = "critical";
    suggestedAction = "exit";
  }

  return {
    estimatedLiquidationPrice: estLiqPrice,
    distancePct,
    riskLevel,
    suggestedAction,
  };
}

// ─── 总风控聚合 ──────────────────────────────────────

export interface OverallRiskStatus {
  /** 合约账户总保证金 USDT */
  totalMargin: number;
  /** 总空单名义 USDT */
  totalShortNotional: number;
  /** 保证金使用率 */
  marginUsageRate: number;
  /** 是否超过使用率限制 */
  marginUsageExceeded: boolean;
  /** 各仓位风险状态 */
  positions: PositionRiskStatus[];
  /** 整体风险评估 */
  overallRisk: "safe" | "warning" | "danger" | "critical";
  /** 建议动作 */
  suggestedActions: string[];
}

/**
 * 评估合约账户整体风控状态
 */
export function assessOverallRisk(
  totalMargin: number,
  positions: { symbol: string; notional: number; liqDistance: number }[],
): OverallRiskStatus {
  const totalShortNotional = positions.reduce((s, p) => s + p.notional, 0);
  const marginUsageRate = totalMargin > 0 ? totalShortNotional / totalMargin : 0;
  const marginUsageExceeded = marginUsageRate > POSITION_LIMITS.MAX_MARGIN_USAGE;

  const positionStatuses: PositionRiskStatus[] = positions.map(p => {
    const level = p.liqDistance > 0.50 ? "safe"
      : p.liqDistance > 0.35 ? "warning"
      : p.liqDistance > 0.25 ? "danger"
      : "critical" as const;
    return {
      symbol: p.symbol,
      exchange: "binance",
      liquidationPrice: 0,
      markPrice: 0,
      shortNotional: p.notional,
      marginBalance: totalMargin,
      marginRatio: 0,
      liquidationDistancePct: p.liqDistance,
      riskLevel: level,
    };
  });

  const suggestedActions: string[] = [];
  if (marginUsageExceeded) {
    suggestedActions.push(`保证金使用率 ${(marginUsageRate * 100).toFixed(1)}% > ${(POSITION_LIMITS.MAX_MARGIN_USAGE * 100).toFixed(0)}%，建议减仓`);
  }

  const criticalCount = positionStatuses.filter(p => p.riskLevel === "critical").length;
  const dangerCount = positionStatuses.filter(p => p.riskLevel === "danger").length;
  const warningCount = positionStatuses.filter(p => p.riskLevel === "warning").length;

  let overallRisk: "safe" | "warning" | "danger" | "critical";
  if (criticalCount > 0) {
    overallRisk = "critical";
    suggestedActions.push(`${criticalCount} 个仓位强平距离 < 15%，立即减仓或退出`);
  } else if (dangerCount > 0) {
    overallRisk = "danger";
    suggestedActions.push(`${dangerCount} 个仓位强平距离 < 25%，强制减半`);
  } else if (warningCount > 0) {
    overallRisk = "warning";
    suggestedActions.push(`${warningCount} 个仓位强平距离 < 50%，预警`);
  } else {
    overallRisk = "safe";
  }

  return {
    totalMargin,
    totalShortNotional,
    marginUsageRate,
    marginUsageExceeded,
    positions: positionStatuses,
    overallRisk,
    suggestedActions,
  };
}
