/**
 * 退出规则优先级（当前未实现合并/仲裁逻辑）：
 *
 * 一、exitRules.ts — 策略级别的"是否应退出"判断
 *    priority: "high" | "medium" | "low"
 *    high: 资金费转负 / 基差 ≤ 0.05% / 持仓超时 / 持仓24h收益不足
 *    medium: 基差 ≤ 0.10% / 基差兑现85% / 达目标收益
 *    low: 基差兑现70% / 资金费 < 0.01%
 *
 * 二、riskArbiter.ts — 风控级别的"强制退出"判断
 *    priority: 1 | 2 | 3 | 10（数值越低越紧急）
 *    1: 仓位偏差>5% / 硬止损 / 回撤10%+ / ADL高风险
 *    2: 回撤5%+ / ADL中高 / 流动性恶化 / 仓位偏差3-5%
 *    3: ADL中等 / 价差扩大
 *    10: 正常（none action）
 *
 * ⚠️ 已知问题：两套优先级体系互不兼容（字符串 vs 数值），
 *    monitor.ts 先调 shouldExitPosition()，后调 riskArbiter，
 *    高优退出条件各自独立判断，不存在 gate 合并逻辑。
 *    这是设计缺陷，但改动风险大，暂只做文档记录。
 */

export interface ExitCheckInput {
  currentExitBasis: number;
  entryBasis: number;
  expectedNetRate: number;
  actualNetProfit: number;
  targetNetProfit: number;
  nextFundingRate: number;
  holdingHours: number;
  isHtxOrSmallCoin: boolean;
}

export interface ExitDecision {
  shouldExit: boolean;
  reason: string;
  priority: "low" | "medium" | "high";
}

export function shouldExitPosition(input: ExitCheckInput): ExitDecision {
  if (input.nextFundingRate < 0) {
    return { shouldExit: true, reason: "资金费转负，默认平仓", priority: "high" };
  }

  if (input.currentExitBasis <= 0.0005) {
    return { shouldExit: true, reason: `平仓可成交基差 ${(input.currentExitBasis * 100).toFixed(3)}% ≤ 0.05%，优先平仓`, priority: "high" };
  }
  if (input.currentExitBasis <= 0.001) {
    return { shouldExit: true, reason: `平仓可成交基差 ${(input.currentExitBasis * 100).toFixed(2)}% ≤ 0.10%，正常平仓`, priority: "medium" };
  }

  const basisRealized = input.entryBasis > 0
    ? (input.entryBasis - input.currentExitBasis) / input.entryBasis
    : 0;
  if (basisRealized >= 0.85) {
    return { shouldExit: true, reason: `入场基差已兑现 ${(basisRealized * 100).toFixed(0)}% ≥ 85%，平仓`, priority: "medium" };
  }
  if (basisRealized >= 0.70) {
    return { shouldExit: true, reason: `入场基差已兑现 ${(basisRealized * 100).toFixed(0)}% ≥ 70%，减仓或平仓`, priority: "low" };
  }

  if (input.actualNetProfit >= input.targetNetProfit) {
    return { shouldExit: true, reason: `实际净收益 $${input.actualNetProfit.toFixed(2)} ≥ 目标`, priority: "medium" };
  }

  if (input.nextFundingRate < 0.0001) {
    return { shouldExit: true, reason: `下一期资金费 ${(input.nextFundingRate * 100).toFixed(3)}% < 0.01%，准备平仓`, priority: "low" };
  }

  const maxHours = input.isHtxOrSmallCoin ? 24 : 72;
  if (input.holdingHours >= maxHours) {
    return { shouldExit: true, reason: `持仓 ${input.holdingHours}h 达上限 ${maxHours}h，强制退出`, priority: "high" };
  }
  if (input.holdingHours >= 48) {
    return { shouldExit: false, reason: `持仓 ${input.holdingHours}h ≥ 48h，强制复核，禁止加仓`, priority: "medium" };
  }
  if (input.holdingHours >= 24 && input.actualNetProfit < input.targetNetProfit * 0.1) {
    return { shouldExit: true, reason: "持仓 24h 净收益不足目标的10%，退出", priority: "high" };
  }

  return { shouldExit: false, reason: "正常持有", priority: "low" };
}
