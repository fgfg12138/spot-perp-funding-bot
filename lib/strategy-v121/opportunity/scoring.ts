import type { CandidateLevel, ScoreBreakdown, MarketSnapshot } from "../domain/types";
import { FUNDING_THRESHOLDS } from "../domain/constants";

export interface ScoringInput {
  path: { spotExchange: string; perpExchange: string };
  spotSnapshot: MarketSnapshot;
  perpSnapshot: MarketSnapshot;
  funding8h: number;
  entryExecutableBasis: number;
}

export interface ScoringResult {
  score: number;
  level: CandidateLevel;
  breakdown: ScoreBreakdown;
  warnings: string[];
}

/**
 * 评分系统（总分 100）
 * 参考 strategy_rules_v121.md 评分表
 */
export function scoreOpportunity(input: ScoringInput): ScoringResult {
  const warnings: string[] = [];

  const availabilityScore = calcAvailability(input);
  const fundingScore = calcFundingScore(input.funding8h, warnings);
  const basisScore = calcBasisScore(input.entryExecutableBasis, warnings);
  const spotLiquidityScore = calcSpotLiquidity(input.spotSnapshot, warnings);
  const perpLiquidityScore = calcPerpLiquidity(input.perpSnapshot, warnings);
  const stabilityScore = calcStability(input.path);
  const riskStatusScore = calcRiskStatus(input);

  const total = availabilityScore + fundingScore + basisScore + spotLiquidityScore
              + perpLiquidityScore + stabilityScore + riskStatusScore;

  const level = determineLevel(total, input.funding8h, input.entryExecutableBasis, warnings);

  return {
    score: total,
    level,
    breakdown: {
      availability: availabilityScore,
      funding: fundingScore,
      basis: basisScore,
      spotLiquidity: spotLiquidityScore,
      perpLiquidity: perpLiquidityScore,
      stability: stabilityScore,
      riskStatus: riskStatusScore,
      total,
    },
    warnings,
  };
}

// ─── 子评分 ──────────────────────────────────────

// 交易可用性 (10分)
function calcAvailability(input: ScoringInput): number {
  const snapOk = input.spotSnapshot.tradingStatus === "trading"
              && input.perpSnapshot.tradingStatus === "trading";
  const dataOk = input.spotSnapshot.bid1 > 0
              && input.perpSnapshot.ask1 > 0
              && input.perpSnapshot.markPrice !== undefined;
  if (!snapOk) return 0;
  if (!dataOk) return 3;
  return 10;
}

// 资金费吸引力 (20分)
// 正资金费 = 收入，越高越好，但 >0.30% 异常降分
function calcFundingScore(funding8h: number, warnings: string[]): number {
  if (funding8h <= 0) return 0;

  // 0.05% → 5分, 0.10% → 12分, 0.20% → 18分, 0.30% → 20分
  const normalMax = FUNDING_THRESHOLDS.ABNORMAL_FUNDING_8H; // 0.003
  if (funding8h <= normalMax) {
    const ratio = funding8h / normalMax;
    return Math.round(ratio * 20);
  }

  // > 0.30%: 异常降分，每 0.10% 扣 5 分
  if (funding8h < FUNDING_THRESHOLDS.BLOCK_FUNDING_8H) {
    const excess = (funding8h - normalMax) / 0.001;
    const score = Math.max(5, 20 - excess * 5);
    warnings.push(`funding_8h ${(funding8h * 100).toFixed(2)}% > 0.30%，异常降分`);
    return Math.round(score);
  }

  // >= 0.50%: 禁止新开仓，给极低分
  warnings.push(`funding_8h ${(funding8h * 100).toFixed(2)}% >= 0.50%，禁止新开仓`);
  return Math.max(0, Math.round(20 - (funding8h - normalMax) / 0.001 * 5));
}

// 可成交基差 (20分)
function calcBasisScore(entryBasis: number, warnings: string[]): number {
  if (entryBasis <= 0) return 0;

  // 0.30% → 8分, 0.50% → 14分, 1.00% → 20分
  if (entryBasis <= 0.01) {
    const ratio = entryBasis / 0.01;
    return Math.round(ratio * 20);
  }

  warnings.push(`开仓基差 ${(entryBasis * 100).toFixed(2)}% > 1.00%，异常检查`);
  return Math.max(5, Math.round(20 - (entryBasis - 0.01) / 0.01 * 10));
}

// 现货流动性 (15分)
function calcSpotLiquidity(snap: MarketSnapshot, warnings: string[]): number {
  let score = 0;

  const vol = snap.volume24hUsdt ?? 0;
  if (vol >= 100_000_000) score += 5;
  else if (vol >= 10_000_000) score += 4;
  else if (vol >= 1_000_000) score += 2;
  else warnings.push("现货24h成交额不足");

  if (snap.spreadRate <= 0.0005) score += 5;
  else if (snap.spreadRate <= 0.001) score += 3;
  else score += 1;

  if (snap.orderBook && snap.orderBook.asks.length >= 10) score += 5;
  else if (snap.orderBook && snap.orderBook.asks.length >= 5) score += 3;
  else score += 1;

  return score;
}

// 合约流动性 (15分)
function calcPerpLiquidity(snap: MarketSnapshot, warnings: string[]): number {
  let score = 0;

  const vol = snap.volume24hUsdt ?? 0;
  if (vol >= 500_000_000) score += 5;
  else if (vol >= 50_000_000) score += 4;
  else if (vol >= 5_000_000) score += 2;
  else warnings.push("合约24h成交额不足");

  if (snap.spreadRate <= 0.0004) score += 5;
  else if (snap.spreadRate <= 0.0008) score += 3;
  else score += 1;

  if (snap.orderBook && snap.orderBook.bids.length >= 10) score += 5;
  else if (snap.orderBook && snap.orderBook.bids.length >= 5) score += 3;
  else score += 1;

  return score;
}

// 路径稳定性 (10分)
function calcStability(path: { spotExchange: string; perpExchange: string }): number {
  if (path.spotExchange === path.perpExchange) {
    return path.spotExchange === "binance" || path.spotExchange === "okx" ? 10 : 7;
  }
  const hasHtx = path.spotExchange === "htx" || path.perpExchange === "htx";
  if (hasHtx) return 3;
  return 7;
}

// 风险状态 (10分)
function calcRiskStatus(input: ScoringInput): number {
  let deductions = 0;

  if (input.spotSnapshot.spreadRate > 0.003) deductions += 4;
  if (input.perpSnapshot.spreadRate > 0.003) deductions += 4;

  if (input.perpSnapshot.markPrice && input.perpSnapshot.indexPrice) {
    const dev = Math.abs(input.perpSnapshot.markPrice / input.perpSnapshot.indexPrice - 1);
    if (dev > 0.03) deductions += 3;
    if (dev > 0.05) deductions += 3;
  }

  return Math.max(0, 10 - deductions);
}

// ─── 等级判定 ────────────────────────────────────

function determineLevel(total: number, funding8h: number, entryBasis: number, warnings: string[]): CandidateLevel {
  const fundingOk = funding8h >= FUNDING_THRESHOLDS.QUALITY_FUNDING_8H;
  const basisOk = entryBasis >= 0.005;
  const fundingMin = funding8h >= FUNDING_THRESHOLDS.MIN_FUNDING_8H;
  const basisMin = entryBasis >= 0.003;

  if (total >= 85 && fundingOk && basisOk) return "S";
  if (total >= 75 && fundingMin && basisMin) return "A";
  if (total >= 65) return "B";

  if (funding8h >= FUNDING_THRESHOLDS.BLOCK_FUNDING_8H) {
    warnings.push("funding >= 0.50% 强制 C 级");
  }
  return "C";
}
