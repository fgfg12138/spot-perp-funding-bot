/**
 * BaseLedgerStore<T> — 账本型 Store 的扩展基类
 *
 * 适用于 internalTransferLedger、orderExecutionLedger、orderPlanLedger
 * 这类以"追加记录 + 最近列表"为主要场景的 Store。
 * 默认不使用 cache（账本数据量大，不需要全量缓存）。
 */

import { BasePersistence } from "./basePersistence";
import type { IPersistenceRepository } from "./repositoryTypes";

export abstract class BaseLedgerStore<T extends { id: string }> extends BasePersistence<T> {
  constructor(tableName: string, repo?: IPersistenceRepository) {
    super(tableName, repo, false); // useCache=false — 账本数据量大，不缓存
  }

  /** 获取最近 N 条记录（按时间倒序） */
  listRecent(limit: number, timeField: keyof T = "createdAtUtc" as keyof T): T[] {
    const all = this.findAll();
    return all
      .sort((a, b) => {
        const aTime = new Date(String(a[timeField])).getTime();
        const bTime = new Date(String(b[timeField])).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  /** 按任意字段等值查找 */
  findByField(field: keyof T, value: unknown): T | undefined {
    const all = this.findAll();
    return all.find((r: any) => r[field] === value);
  }
}
