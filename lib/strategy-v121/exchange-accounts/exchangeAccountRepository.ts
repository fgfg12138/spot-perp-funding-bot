/**
 * ExchangeAccountRepository — 交易所账户 CRUD + 能力查询。
 *
 * 通过 IPersistenceRepository 抽象实现，支持 JSONL 和 SQLite 后端。
 */

import type { IPersistenceRepository } from "../persistence/repositoryTypes";
import type { ExchangeAccountRecord, ExchangeCapability } from "./types";

const ACCOUNTS_TABLE = "exchange_accounts";
const CAPABILITIES_TABLE = "exchange_capabilities";

export class ExchangeAccountRepository {
  constructor(private repo: IPersistenceRepository) {}

  // ─── Accounts CRUD ──────────────────────────────────

  /** 保存账户记录（INSERT OR REPLACE 语义）。 */
  saveAccount(record: ExchangeAccountRecord): void {
    const row = this.accountToRow(record);
    this.repo.save(ACCOUNTS_TABLE, row);
  }

  /** 通过 ID 获取账户记录（last-write-wins）。 */
  findAccountById(id: string): ExchangeAccountRecord | undefined {
    const all = this.repo.queryAll(ACCOUNTS_TABLE);
    const found = [...all].reverse().find(r => r.id === id);
    return found ? this.rowToAccount(found) : undefined;
  }

  /** 获取所有账户（去重，last-write-wins）。 */
  listAccounts(): ExchangeAccountRecord[] {
    const all = this.repo.queryAll(ACCOUNTS_TABLE);
    const seen = new Map<string, Record<string, unknown>>();
    for (const r of all) {
      seen.set(r.id as string, r);
    }
    return [...seen.values()].map(r => this.rowToAccount(r));
  }

  /** 按交易所筛选（去重，last-write-wins）。 */
  listAccountsByExchange(exchange: string): ExchangeAccountRecord[] {
    return this.listAccounts().filter(a => a.exchange === exchange);
  }

  /** 仅获取启用的账户（去重，last-write-wins）。 */
  listEnabledAccounts(): ExchangeAccountRecord[] {
    return this.listAccounts().filter(a => a.enabled);
  }

  /** 删除账户及对应的能力记录。 */
  deleteAccount(id: string): void {
    this.repo.deleteById(ACCOUNTS_TABLE, id);
    // capabilities 表主键是 account_id，不是 id，需要用 query 过滤后清空重建
    this._deleteCapabilityByAccountId(id);
  }

  /** 通过 account_id 删除能力记录（capabilities 表 PK = account_id）。 */
  private _deleteCapabilityByAccountId(accountId: string): void {
    const all = this.repo.queryAll(CAPABILITIES_TABLE);
    const kept = all.filter(r => r.account_id !== accountId);
    this.repo.clear(CAPABILITIES_TABLE);
    for (const r of kept) {
      this.repo.save(CAPABILITIES_TABLE, r);
    }
  }

  /** 获取账户数量。 */
  accountCount(): number {
    return this.repo.count(ACCOUNTS_TABLE);
  }

  // ─── Capabilities CRUD ──────────────────────────────

  /** 保存 / 更新能力记录（UPSERT 语义）。 */
  saveCapability(cap: ExchangeCapability): void {
    const row = this.capabilityToRow(cap);
    this.repo.save(CAPABILITIES_TABLE, row);
  }

  /** 通过账户 ID 获取能力（last-write-wins）。 */
  findCapabilityByAccountId(accountId: string): ExchangeCapability | undefined {
    const all = this.repo.queryAll(CAPABILITIES_TABLE);
    const found = [...all].reverse().find(r => r.account_id === accountId);
    return found ? this.rowToCapability(found) : undefined;
  }

  // ─── Row ↔ Domain 转换 ──────────────────────────────

  private accountToRow(record: ExchangeAccountRecord): Record<string, unknown> {
    return {
      id: record.id,
      exchange: record.exchange,
      label: record.label,
      masked_api_key: record.maskedApiKey,
      encrypted_api_key_json: record.encryptedApiKeyJson,
      encrypted_secret_json: record.encryptedSecretJson,
      encrypted_passphrase_json: record.encryptedPassphraseJson ?? null,
      enabled: record.enabled,
      created_at_utc: record.createdAtUtc,
      updated_at_utc: record.updatedAtUtc,
    };
  }

  private rowToAccount(row: Record<string, unknown>): ExchangeAccountRecord {
    return {
      id: row.id as string,
      exchange: row.exchange as ExchangeAccountRecord["exchange"],
      label: row.label as string,
      maskedApiKey: row.masked_api_key as string,
      encryptedApiKeyJson: row.encrypted_api_key_json as string,
      encryptedSecretJson: row.encrypted_secret_json as string,
      encryptedPassphraseJson: (row.encrypted_passphrase_json as string) ?? undefined,
      enabled: row.enabled as boolean,
      createdAtUtc: row.created_at_utc as string,
      updatedAtUtc: row.updated_at_utc as string,
    };
  }

  private capabilityToRow(cap: ExchangeCapability): Record<string, unknown> {
    return {
      account_id: cap.accountId,
      exchange: cap.exchange,
      read_balance: cap.readBalance,
      read_spot: cap.readSpot,
      read_perp: cap.readPerp,
      trade_spot: cap.tradeSpot,
      trade_perp: cap.tradePerp,
      internal_transfer: cap.internalTransfer,
      funding_rate: cap.fundingRate,
      positions: cap.positions,
      orders: cap.orders,
      same_exchange_arb_enabled: cap.sameExchangeArbEnabled,
      cross_exchange_arb_enabled: cap.crossExchangeArbEnabled,
      last_checked_at_utc: cap.lastCheckedAtUtc ?? null,
      last_error: cap.lastError ?? null,
      raw_json: cap.rawJson ?? "{}",
    };
  }

  private rowToCapability(row: Record<string, unknown>): ExchangeCapability {
    return {
      accountId: row.account_id as string,
      exchange: row.exchange as ExchangeCapability["exchange"],
      readBalance: row.read_balance as boolean,
      readSpot: row.read_spot as boolean,
      readPerp: row.read_perp as boolean,
      tradeSpot: row.trade_spot as boolean,
      tradePerp: row.trade_perp as boolean,
      internalTransfer: row.internal_transfer as boolean,
      fundingRate: row.funding_rate as boolean,
      positions: row.positions as boolean,
      orders: row.orders as boolean,
      sameExchangeArbEnabled: row.same_exchange_arb_enabled as boolean,
      crossExchangeArbEnabled: row.cross_exchange_arb_enabled as boolean,
      lastCheckedAtUtc: (row.last_checked_at_utc as string) ?? undefined,
      lastError: (row.last_error as string) ?? undefined,
      rawJson: (row.raw_json as string) ?? undefined,
    };
  }
}
