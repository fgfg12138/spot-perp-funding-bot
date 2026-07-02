/**
 * BasePersistence<T> — 业务实体的持久化基类
 *
 * T 必须有一个 string 类型的 id 字段。
 * 子类只需声明 tableName，即可自动获得 CRUD 功能。
 * 默认不使用 cache，子类可设置 useCache=true 启用。
 */

import type { IPersistenceRepository } from "./repositoryTypes";
import { getRepository } from "./repositoryFactory";

export abstract class BasePersistence<T extends { id: string }> {
  /** 底层存储引擎 */
  protected repo: IPersistenceRepository;

  /** 表名 */
  protected tableName: string;

  /** 是否启用内存缓存 */
  protected useCache: boolean;

  /** 缓存实例（仅当 useCache=true 时使用） */
  protected cache = new Map<string, T>();

  constructor(tableName: string, repo?: IPersistenceRepository, useCache = false) {
    this.tableName = tableName;
    this.repo = repo ?? getRepository();
    this.useCache = useCache;
    if (this.useCache) {
      this.loadFromDisk();
    }
  }

  /**
   * 从磁盘加载到缓存。
   * 只在 useCache=true 时调用。
   */
  private loadFromDisk(): void {
    try {
      const records = this.repo.queryAll(this.tableName) as T[];
      for (const r of records) {
        if (r.id) this.cache.set(r.id, r);
      }
    } catch (e) {
      console.error(`[${this.tableName}] load from disk failed`, e);
    }
  }

  /**
   * 将缓存全量写回磁盘。
   * 只在 useCache=true 时调用。
   */
  protected flushToDisk(): void {
    this.repo.clear(this.tableName);
    for (const record of this.cache.values()) {
      this.repo.save(this.tableName, record as any);
    }
  }

  // ─── 公有 API ──────────────────────────────────

  /** 保存一条记录。启用缓存时同时更新缓存。 */
  save(record: T): void {
    if (this.useCache) {
      this.cache.set(record.id, { ...record });
      this.flushToDisk();
    } else {
      // 先删后写，避免 append-only 导致重复
      this.repo.deleteById(this.tableName, record.id);
      this.repo.save(this.tableName, record as any);
    }
  }

  /** 批量保存 */
  saveAll(records: T[]): void {
    for (const r of records) this.save(r);
  }

  /** 按 ID 查找（返回浅拷贝副本） */
  findById(id: string): T | undefined {
    if (this.useCache) {
      const found = this.cache.get(id);
      return found ? { ...found } : undefined;
    }
    const all = this.repo.queryAll(this.tableName) as T[];
    const found = all.find((r: any) => r.id === id);
    return found ? { ...found } : undefined;
  }

  /** 返回所有记录（浅拷贝副本） */
  findAll(): T[] {
    if (this.useCache) {
      return Array.from(this.cache.values()).map(r => ({ ...r }));
    }
    return (this.repo.queryAll(this.tableName) as T[]).map(r => ({ ...r }));
  }

  /** 删除（启用缓存时同步更新缓存） */
  delete(id: string): void {
    if (this.useCache) {
      this.cache.delete(id);
      this.flushToDisk();
    } else {
      this.repo.deleteById(this.tableName, id);
    }
  }

  /** 检查记录是否存在 */
  exists(id: string): boolean {
    return this.findById(id) !== undefined;
  }

  /** 计数 */
  count(): number {
    if (this.useCache) return this.cache.size;
    return this.repo.count(this.tableName);
  }

  /** 清空表 */
  clear(): void {
    if (this.useCache) {
      this.cache.clear();
    }
    this.repo.clear(this.tableName);
  }
}
