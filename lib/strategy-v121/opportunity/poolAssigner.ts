/**
 * 最终分池逻辑
 *
 * 规则：
 * - >= 80: 核心可交易池
 * - 70-80: 机会池，小仓交易
 * - 60-70: 观察池，只报警
 * - < 60: 不做
 *
 * 同时必须满足：
 * - 硬过滤全部通过（passed === true）
 * - 预计24小时净收益率 > 0.10%
 * - 合约杠杆 <= 2x
 * - 单币仓位不超过上限
 * - 没有暂停/下架/维护风险
 */

// ─── V2 分池类型 ────────────────────────────────────

export type PoolName = "core" | "opportunity" | "watch" | "reject";

export interface PoolAssignment {
  pool: PoolName;
  reason: string;
}

// ─────────────────────────────────────────────────────

export interface PoolAssignInput {
  /** V2 评分总分（0-100） */
  score: number;
  /** 硬过滤是否通过 */
  hardFilterPassed: boolean;
  /** 预计 24h 净收益率 */
  expectedNetProfit24h: number;
  /** 是否属于小币/Meme */
  isSmallCap: boolean;
  /** 是否有下架/暂停/维护风险 */
  hasDelistRisk: boolean;
}

/**
 * 分配一个机会到对应的池。
 *
 * @returns pool 和原因说明
 */
export function assignPool(input: PoolAssignInput): PoolAssignment {
  // 条件不满足：直接淘汰
  if (!input.hardFilterPassed) {
    return { pool: "reject", reason: "硬过滤未通过" };
  }

  if (input.expectedNetProfit24h < 0.001) {
    return { pool: "reject", reason: `24h 净收益 ${(input.expectedNetProfit24h * 100).toFixed(2)}% < 0.10%` };
  }

  if (input.hasDelistRisk) {
    return { pool: "reject", reason: "存在下架/暂停/维护风险" };
  }

  // 按分数分池
  if (input.score >= 80) {
    return { pool: "core", reason: `评分 ${input.score} >= 80，核心可交易池` };
  }

  if (input.score >= 70) {
    if (input.isSmallCap) {
      return { pool: "watch", reason: `评分 ${input.score}（机会档），但 ${input.isSmallCap ? '小币/Meme' : ''}，降至观察池` };
    }
    return { pool: "opportunity", reason: `评分 ${input.score}（70-80），机会池` };
  }

  if (input.score >= 60) {
    return { pool: "watch", reason: `评分 ${input.score}（60-70），观察池` };
  }

  return { pool: "reject", reason: `评分 ${input.score} < 60，不做` };
}
