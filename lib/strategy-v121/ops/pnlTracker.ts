/**
 * P5.3 — PNL 实时追踪
 *
 * 监听 spot + perpetual 头寸，计算未实现/已实现 PNL，
 * 定期快照到 repository。支持按 position / exchange / symbol 查询。
 */
import { getRepository } from "../persistence/repositoryFactory";

// ── 类型定义 ──────────────────────────────────────────────

export interface PnlSnapshot {
  id: string;
  positionId: string;
  exchange: string;
  symbol: string;

  /** 当前持仓名义价值 */
  spotNotional: number;
  perpNotional: number;

  /** 入场时的均价 */
  spotEntryPrice: number;
  perpEntryPrice: number;

  /** 当前市场价 */
  spotCurrentPrice: number;
  perpCurrentPrice: number;

  /** 资金费累计（自开仓以来） */
  cumulativeFundingUsdt: number;

  /** 未实现 PNL（基于当前市场价） */
  unrealizedPnl: number;

  /** 已实现 PNL（平仓/部分平仓） */
  realizedPnl: number;

  /** 总 PNL = unrealized + realized */
  totalPnl: number;

  /** 收益率（相对于总保证金） */
  returnPercent: number;

  /** 开仓时间 */
  openedAtUtc: number;
  /** 快照时间 */
  snapshotAtUtc: number;

  /** 头寸状态 */
  state: "OPEN" | "MONITORING" | "CLOSED" | "FROZEN";

  /** PNL 等级（快速参考） */
  pnlLevel: "profit" | "breakeven" | "loss" | "critical_loss";

  /** 备注 */
  notes?: string;
}

// ── 核心写入 ──────────────────────────────────────────────

export interface PnlInput {
  positionId: string;
  exchange: string;
  symbol: string;
  spotNotional: number;
  perpNotional: number;
  spotEntryPrice: number;
  perpEntryPrice: number;
  spotCurrentPrice: number;
  perpCurrentPrice: number;
  cumulativeFundingUsdt: number;
  realizedPnl: number;
  openedAtUtc: number;
  state: PnlSnapshot["state"];
  notes?: string;
}

/**
 * 计算并保存一次 PNL 快照。
 */
export function capturePnlSnapshot(input: PnlInput): PnlSnapshot {
  const now = Date.now();

  // 计算未实现 PNL
  // Spot PNL: (spotCurrentPrice - spotEntryPrice) / spotEntryPrice * spotNotional
  // Perp PNL: (perpEntryPrice - perpCurrentPrice) / perpEntryPrice * perpNotional (空头)
  const spotPnl = input.spotEntryPrice > 0
    ? ((input.spotCurrentPrice - input.spotEntryPrice) / input.spotEntryPrice) * input.spotNotional
    : 0;
  const perpPnl = input.perpEntryPrice > 0
    ? ((input.perpEntryPrice - input.perpCurrentPrice) / input.perpEntryPrice) * input.perpNotional
    : 0;

  const unrealizedPnl = spotPnl + perpPnl;
  const totalPnl = unrealizedPnl + input.realizedPnl;

  // 收益率：基于总名义价值的 50%（假设 2x 杠杆）
  const totalMargin = (input.spotNotional + input.perpNotional) / 2;
  const returnPercent = totalMargin > 0 ? (totalPnl / totalMargin) * 100 : 0;

  // PNL 等级
  let pnlLevel: PnlSnapshot["pnlLevel"];
  if (totalPnl <= -totalMargin * 0.1) {
    pnlLevel = "critical_loss";
  } else if (totalPnl < -totalMargin * 0.01) {
    pnlLevel = "loss";
  } else if (totalPnl < totalMargin * 0.01) {
    pnlLevel = "breakeven";
  } else {
    pnlLevel = "profit";
  }

  const snapshot: PnlSnapshot = {
    id: `pnl-${input.positionId}-${now}`,
    positionId: input.positionId,
    exchange: input.exchange,
    symbol: input.symbol,
    spotNotional: input.spotNotional,
    perpNotional: input.perpNotional,
    spotEntryPrice: input.spotEntryPrice,
    perpEntryPrice: input.perpEntryPrice,
    spotCurrentPrice: input.spotCurrentPrice,
    perpCurrentPrice: input.perpCurrentPrice,
    cumulativeFundingUsdt: input.cumulativeFundingUsdt,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    realizedPnl: input.realizedPnl,
    totalPnl: Math.round(totalPnl * 100) / 100,
    returnPercent: Math.round(returnPercent * 100) / 100,
    openedAtUtc: input.openedAtUtc,
    snapshotAtUtc: now,
    state: input.state,
    pnlLevel,
    notes: input.notes,
  };

  try {
    const repo = getRepository();
    repo.save("pnl_snapshots", snapshot as unknown as Record<string, unknown>);
  } catch {
    // PNL 快照失败不应中断主流程
  }

  return snapshot;
}

// ── 查询 ──────────────────────────────────────────────────

export interface PnlQuery {
  positionId?: string;
  exchange?: string;
  symbol?: string;
  state?: PnlSnapshot["state"];
  pnlLevel?: PnlSnapshot["pnlLevel"];
  sinceUtc?: number;
  untilUtc?: number;
  limit?: number;
}

/** 查询 PNL 快照 */
export function queryPnlSnapshots(query: PnlQuery): PnlSnapshot[] {
  try {
    const repo = getRepository();
    const all = repo.queryAll("pnl_snapshots") as unknown as PnlSnapshot[];
    let filtered = all;

    if (query.positionId) filtered = filtered.filter((s) => s.positionId === query.positionId);
    if (query.exchange) filtered = filtered.filter((s) => s.exchange === query.exchange);
    if (query.symbol) filtered = filtered.filter((s) => s.symbol === query.symbol);
    if (query.state) filtered = filtered.filter((s) => s.state === query.state);
    if (query.pnlLevel) filtered = filtered.filter((s) => s.pnlLevel === query.pnlLevel);
    if (query.sinceUtc) filtered = filtered.filter((s) => s.snapshotAtUtc >= query.sinceUtc!);
    if (query.untilUtc) filtered = filtered.filter((s) => s.snapshotAtUtc <= query.untilUtc!);

    filtered.sort((a, b) => b.snapshotAtUtc - a.snapshotAtUtc);

    if (query.limit && query.limit > 0) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  } catch {
    return [];
  }
}

/** 获取某个仓位的最新 PNL 快照 */
export function getLatestPnl(positionId: string): PnlSnapshot | undefined {
  const snapshots = queryPnlSnapshots({ positionId, limit: 1 });
  return snapshots[0];
}

/** 获取所有亏损仓位（用于告警） */
export function getLossPositions(minLossUsdt = 0): PnlSnapshot[] {
  return queryPnlSnapshots({
    pnlLevel: "loss",
    limit: 100,
  }).filter((s) => s.totalPnl <= -minLossUsdt);
}

/** 获取所有严重亏损仓位 */
export function getCriticalLossPositions(): PnlSnapshot[] {
  return queryPnlSnapshots({ pnlLevel: "critical_loss", limit: 100 });
}
