/**
 * P5.2 — 结构化审计日志
 *
 * 记录所有执行决策、状态转换、订单尝试到 SQLite / JSONL。
 * 提供查询和导出能力。
 */
import { getRepository } from "../persistence/repositoryFactory";

// ── 日志级别 ──────────────────────────────────────────────

export type AuditLevel = "INFO" | "WARN" | "ERROR" | "SECURITY";

// ── 日志条目类型 ──────────────────────────────────────────

export interface AuditEntry {
  id: string;
  level: AuditLevel;
  category: string;
  message: string;
  detail?: string;           // JSON 字符串
  workerId?: string;
  exchange?: string;
  symbol?: string;
  intentId?: string;
  positionId?: string;
  durationMs?: number;
  createdAtUtc: number;
}

// ── 类别常量（推荐使用） ──────────────────────────────────

export const AuditCategory = {
  /** Worker 生命周期：start / stop / pause / error / 心跳异常 */
  WORKER_LIFECYCLE: "worker.lifecycle",
  /** 市场数据刷新 */
  MARKET_REFRESH: "market.refresh",
  /** 机会扫描与告警 */
  OPPORTUNITY: "opportunity",
  /** 入场决策与执行 */
  ENTRY: "entry",
  /** 平仓执行 */
  EXIT: "exit",
  /** 资金费率结算 */
  FUNDING: "funding",
  /** 内部转账 */
  TRANSFER: "transfer",
  /** 审计门禁检查结果 */
  AUDIT_GATE: "audit.gate",
  /** 安全相关（密钥泄露、越权访问等） */
  SECURITY: "security",
  /** 配置变更 */
  CONFIG: "config",
  /** 错误恢复 */
  RECOVERY: "recovery",
  /** 用户操作 */
  USER_ACTION: "user.action",
  /** 持仓快照 */
  POSITION: "position",
} as const;

// ── 全局开启/关闭控制（方便测试） ─────────────────────────

let auditEnabled = true;

export function setAuditEnabled(enabled: boolean): void {
  auditEnabled = enabled;
}

export function isAuditEnabled(): boolean {
  return auditEnabled;
}

// ── 核心写入 ──────────────────────────────────────────────

/**
 * 写入一条审计日志。
 * 如果 `auditEnabled` 为 false（如测试环境），直接跳过。
 */
export function writeAuditLog(entry: Omit<AuditEntry, "id" | "createdAtUtc">): string {
  if (!auditEnabled) return "";

  const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const full: AuditEntry = {
    ...entry,
    id,
    createdAtUtc: Date.now(),
  };

  try {
    const repo = getRepository();
    repo.save("audit_log", full as unknown as Record<string, unknown>);
  } catch {
    // 审计日志写入失败不应中断主流程
    // 回退到 console
    console.error(`[auditLogger] 写入失败: ${full.category} / ${full.message}`);
  }

  return id;
}

// ── 便捷方法 ──────────────────────────────────────────────

export function auditInfo(
  category: string,
  message: string,
  meta?: {
    detail?: Record<string, unknown>;
    workerId?: string;
    exchange?: string;
    symbol?: string;
    intentId?: string;
    positionId?: string;
    durationMs?: number;
  },
): string {
  return writeAuditLog({
    level: "INFO",
    category,
    message,
    detail: meta?.detail ? JSON.stringify(meta.detail) : undefined,
    workerId: meta?.workerId,
    exchange: meta?.exchange,
    symbol: meta?.symbol,
    intentId: meta?.intentId,
    positionId: meta?.positionId,
    durationMs: meta?.durationMs,
  });
}

export function auditWarn(
  category: string,
  message: string,
  meta?: {
    detail?: Record<string, unknown>;
    workerId?: string;
    exchange?: string;
    symbol?: string;
    intentId?: string;
    positionId?: string;
    durationMs?: number;
  },
): string {
  return writeAuditLog({
    level: "WARN",
    category,
    message,
    detail: meta?.detail ? JSON.stringify(meta.detail) : undefined,
    workerId: meta?.workerId,
    exchange: meta?.exchange,
    symbol: meta?.symbol,
    intentId: meta?.intentId,
    positionId: meta?.positionId,
    durationMs: meta?.durationMs,
  });
}

export function auditError(
  category: string,
  message: string,
  meta?: {
    detail?: Record<string, unknown>;
    workerId?: string;
    exchange?: string;
    symbol?: string;
    intentId?: string;
    positionId?: string;
    durationMs?: number;
    error?: Error;
  },
): string {
  const detail = {
    ...(meta?.detail ?? {}),
    ...(meta?.error ? { errorMessage: meta.error.message, errorStack: meta.error.stack } : {}),
  };
  return writeAuditLog({
    level: "ERROR",
    category,
    message,
    detail: JSON.stringify(detail),
    workerId: meta?.workerId,
    exchange: meta?.exchange,
    symbol: meta?.symbol,
    intentId: meta?.intentId,
    positionId: meta?.positionId,
    durationMs: meta?.durationMs,
  });
}

export function auditSecurity(
  message: string,
  meta?: {
    detail?: Record<string, unknown>;
    workerId?: string;
    exchange?: string;
  },
): string {
  return writeAuditLog({
    level: "SECURITY",
    category: AuditCategory.SECURITY,
    message,
    detail: meta?.detail ? JSON.stringify(meta.detail) : undefined,
    workerId: meta?.workerId,
    exchange: meta?.exchange,
  });
}

// ── 查询 ──────────────────────────────────────────────────

export interface AuditQuery {
  level?: AuditLevel;
  category?: string;
  workerId?: string;
  exchange?: string;
  symbol?: string;
  intentId?: string;
  sinceUtc?: number;
  untilUtc?: number;
  limit?: number;
}

/** 查询审计日志 */
export function queryAuditLogs(query: AuditQuery): AuditEntry[] {
  try {
    const repo = getRepository();
    const all = repo.queryAll("audit_log") as unknown as AuditEntry[];
    let filtered = all;

    if (query.level) filtered = filtered.filter((e) => e.level === query.level);
    if (query.category) filtered = filtered.filter((e) => e.category === query.category);
    if (query.workerId) filtered = filtered.filter((e) => e.workerId === query.workerId);
    if (query.exchange) filtered = filtered.filter((e) => e.exchange === query.exchange);
    if (query.symbol) filtered = filtered.filter((e) => e.symbol === query.symbol);
    if (query.intentId) filtered = filtered.filter((e) => e.intentId === query.intentId);
    if (query.sinceUtc) filtered = filtered.filter((e) => e.createdAtUtc >= query.sinceUtc!);
    if (query.untilUtc) filtered = filtered.filter((e) => e.createdAtUtc <= query.untilUtc!);

    // 按时间倒序
    filtered.sort((a, b) => b.createdAtUtc - a.createdAtUtc);

    if (query.limit && query.limit > 0) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  } catch {
    return [];
  }
}

/** 获取最近的审计日志 */
export function getRecentAuditLogs(limit = 50): AuditEntry[] {
  return queryAuditLogs({ limit });
}

/** 获取错误审计日志 */
export function getErrorAuditLogs(limit = 50): AuditEntry[] {
  return queryAuditLogs({ level: "ERROR", limit });
}

/** 获取安全审计日志 */
export function getSecurityAuditLogs(limit = 50): AuditEntry[] {
  return queryAuditLogs({ level: "SECURITY", limit });
}
