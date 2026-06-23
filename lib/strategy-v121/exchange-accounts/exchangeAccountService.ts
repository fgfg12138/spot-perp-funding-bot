/**
 * ExchangeAccountService — 交易所账户管理服务层。
 *
 * 负责：
 *  - 加密明文 API Key/Secret/Passphrase（使用 masterKey + apiKeyCrypto）
 *  - 生成 masked_api_key
 *  - 通过 ExchangeAccountRepository 持久化
 *  - 触发 capabilityDetector 探测并保存能力
 *  - 生成前端可见的 ExchangeAccountSummary（不含密钥）
 */

import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret, maskApiKey, type EncryptedPayload } from "../../security/apiKeyCrypto";
import { getMasterKey, isMasterKeyConfigured } from "./masterKey";
import { ExchangeAccountRepository } from "./exchangeAccountRepository";
import { detectCapabilities } from "./capabilityDetector";
import { decideArbCapability } from "./capabilityEngine";
import { createRuntimeAdapter, type RuntimeApiKeyInput } from "./runtimeAdapterFactory";
import type { IPersistenceRepository } from "../persistence/repositoryTypes";
import type { ExchangeId } from "../domain/types";
import type {
  ExchangeAccountRecord,
  ExchangeAccountSummary,
  CreateExchangeAccountInput,
  UpdateExchangeAccountInput,
  ExchangeCapability,
  CapabilityProbeReport,
} from "./types";

// ─── 校验 ───────────────────────────────────────────

const VALID_EXCHANGES: ExchangeId[] = ["binance", "okx", "htx"];

function validateInput(input: CreateExchangeAccountInput): string[] {
  const errors: string[] = [];
  if (!VALID_EXCHANGES.includes(input.exchange)) {
    errors.push(`不支持的交易所: ${input.exchange}`);
  }
  if (!input.label || input.label.trim().length === 0) {
    errors.push("label 不能为空");
  }
  if (!input.apiKey || input.apiKey.trim().length === 0) {
    errors.push("apiKey 不能为空");
  }
  if (!input.apiSecret || input.apiSecret.trim().length === 0) {
    errors.push("apiSecret 不能为空");
  }
  if (input.exchange === "okx" && (!input.passphrase || input.passphrase.trim().length === 0)) {
    errors.push("OKX 账户必须提供 passphrase");
  }
  return errors;
}

// ─── Service ────────────────────────────────────────

export class ExchangeAccountService {
  private repo: ExchangeAccountRepository;

  constructor(persistence: IPersistenceRepository) {
    this.repo = new ExchangeAccountRepository(persistence);
  }

  /**
   * 创建新账户并加密保存。
   * @throws Error 当 master key 未配置或输入校验失败时。
   */
  async createAccount(input: CreateExchangeAccountInput): Promise<ExchangeAccountSummary> {
    if (!isMasterKeyConfigured()) {
      throw new Error("V121_MASTER_KEY 未配置，无法加密保存 API Key");
    }

    const errors = validateInput(input);
    if (errors.length > 0) {
      throw new Error(`输入校验失败: ${errors.join("; ")}`);
    }

    const masterKey = getMasterKey();
    const now = new Date().toISOString();
    const id = `acc_${randomUUID()}`;

    const encryptedApiKey = encryptSecret(input.apiKey.trim(), masterKey);
    const encryptedSecret = encryptSecret(input.apiSecret.trim(), masterKey);
    const encryptedPassphrase = input.passphrase
      ? encryptSecret(input.passphrase.trim(), masterKey)
      : undefined;

    const record: ExchangeAccountRecord = {
      id,
      exchange: input.exchange,
      label: input.label.trim(),
      maskedApiKey: maskApiKey(input.apiKey.trim()),
      encryptedApiKeyJson: JSON.stringify(encryptedApiKey),
      encryptedSecretJson: JSON.stringify(encryptedSecret),
      encryptedPassphraseJson: encryptedPassphrase ? JSON.stringify(encryptedPassphrase) : undefined,
      enabled: true,
      createdAtUtc: now,
      updatedAtUtc: now,
    };

    this.repo.saveAccount(record);

    return this.toSummary(record);
  }

  /** 列出所有账户（前端可见摘要）。 */
  listAccounts(): ExchangeAccountSummary[] {
    return this.repo.listAccounts().map(r => this.toSummary(r));
  }

  /** 获取单个账户摘要。 */
  getAccount(id: string): ExchangeAccountSummary | undefined {
    const record = this.repo.findAccountById(id);
    return record ? this.toSummary(record) : undefined;
  }

  /** 更新 label 或 enabled。 */
  updateAccount(id: string, input: UpdateExchangeAccountInput): ExchangeAccountSummary {
    const record = this.repo.findAccountById(id);
    if (!record) {
      throw new Error(`账户不存在: ${id}`);
    }

    if (input.label !== undefined) {
      if (input.label.trim().length === 0) {
        throw new Error("label 不能为空");
      }
      record.label = input.label.trim();
    }
    if (input.enabled !== undefined) {
      record.enabled = input.enabled;
    }
    record.updatedAtUtc = new Date().toISOString();

    this.repo.saveAccount(record);
    return this.toSummary(record);
  }

  /** 删除账户及其能力记录。 */
  deleteAccount(id: string): void {
    const record = this.repo.findAccountById(id);
    if (!record) {
      throw new Error(`账户不存在: ${id}`);
    }
    this.repo.deleteAccount(id);
  }

  /**
   * 对账户执行只读权限探测并保存能力。
   *
   * 完整闭环：
   *  1. 读取账户记录
   *  2. 使用 V121_MASTER_KEY 解密 apiKey / secret / passphrase
   *  3. 构造 runtime adapter（运行时密钥注入，不依赖 process.env）
   *  4. 调 capabilityDetector 探测只读权限
   *  5. 应用 capabilityEngine 套利决策
   *  6. 写入 exchange_capabilities
   *  7. 返回脱敏结果（不含明文/密文密钥）
   *
   * 安全：
   *  - V121_MASTER_KEY 未配置时拒绝探测。
   *  - 明文密钥仅在服务端内存中短暂持有，不写入日志，不返回给调用方。
   *  - 不执行真实下单、不执行真实划转。
   *  - 不检测提现权限作为唯一安全依据。
   *
   * @returns CapabilityProbeReport
   */
  async probeAccount(id: string): Promise<CapabilityProbeReport> {
    const record = this.repo.findAccountById(id);
    if (!record) {
      throw new Error(`账户不存在: ${id}`);
    }

    // V121_MASTER_KEY 未配置时拒绝探测
    if (!isMasterKeyConfigured()) {
      const emptyCap = this.makeEmptyCapability(
        id,
        record.exchange,
        "本地加密密钥未配置，无法解密 API Key 进行权限检测",
      );
      this.repo.saveCapability(emptyCap);
      return {
        accountId: id,
        exchange: record.exchange,
        probes: [],
        capability: emptyCap,
        timestampUtc: new Date().toISOString(),
      };
    }

    // 解密 API Key / Secret / Passphrase
    let runtimeInput: RuntimeApiKeyInput;
    try {
      const masterKey = getMasterKey();
      const encryptedApiKey = JSON.parse(record.encryptedApiKeyJson) as EncryptedPayload;
      const encryptedSecret = JSON.parse(record.encryptedSecretJson) as EncryptedPayload;
      const apiKey = decryptSecret(encryptedApiKey, masterKey);
      const apiSecret = decryptSecret(encryptedSecret, masterKey);
      let passphrase: string | undefined;
      if (record.encryptedPassphraseJson) {
        const encryptedPass = JSON.parse(record.encryptedPassphraseJson) as EncryptedPayload;
        passphrase = decryptSecret(encryptedPass, masterKey);
      }
      runtimeInput = { exchange: record.exchange, apiKey, apiSecret, passphrase };
    } catch (err: any) {
      const emptyCap = this.makeEmptyCapability(
        id,
        record.exchange,
        `解密 API Key 失败: ${err.message ?? String(err)}`,
      );
      this.repo.saveCapability(emptyCap);
      return {
        accountId: id,
        exchange: record.exchange,
        probes: [],
        capability: emptyCap,
        timestampUtc: new Date().toISOString(),
      };
    }

    // 构造 runtime adapter（运行时密钥注入）
    const { adapter, status, message } = createRuntimeAdapter(runtimeInput);

    // OKX not_supported / HTX observe_only / 密钥不完整：记录原因但不抛错
    if (status !== "ok") {
      const emptyCap = this.makeEmptyCapability(
        id,
        record.exchange,
        message ?? `运行时 adapter 状态: ${status}`,
      );
      // HTX observe-only：healthCheck 仍可执行，但账户探测不可用
      this.repo.saveCapability(emptyCap);
      return {
        accountId: id,
        exchange: record.exchange,
        probes: [],
        capability: emptyCap,
        timestampUtc: new Date().toISOString(),
      };
    }

    // 探测只读权限
    const report = await detectCapabilities(adapter, id);
    // 应用套利决策
    const decision = decideArbCapability(report.capability);
    const finalCap: ExchangeCapability = {
      ...report.capability,
      sameExchangeArbEnabled: decision.sameExchangeArbEnabled,
      crossExchangeArbEnabled: decision.crossExchangeArbEnabled,
    };
    this.repo.saveCapability(finalCap);

    return {
      ...report,
      capability: finalCap,
    };
  }

  /** 构造空能力记录（探测未执行时使用）。 */
  private makeEmptyCapability(
    accountId: string,
    exchange: ExchangeId,
    lastError: string,
  ): ExchangeCapability {
    return {
      accountId,
      exchange,
      readBalance: false,
      readSpot: false,
      readPerp: false,
      tradeSpot: false,
      tradePerp: false,
      internalTransfer: false,
      fundingRate: false,
      positions: false,
      orders: false,
      sameExchangeArbEnabled: false,
      crossExchangeArbEnabled: false,
      lastCheckedAtUtc: new Date().toISOString(),
      lastError,
      rawJson: "{}",
    };
  }

  /** 获取账户的能力记录。 */
  getCapability(id: string): ExchangeCapability | undefined {
    return this.repo.findCapabilityByAccountId(id);
  }

  // ─── 内部转换 ─────────────────────────────────────

  private toSummary(record: ExchangeAccountRecord): ExchangeAccountSummary {
    const cap = this.repo.findCapabilityByAccountId(record.id);
    return {
      id: record.id,
      exchange: record.exchange,
      label: record.label,
      maskedApiKey: record.maskedApiKey,
      enabled: record.enabled,
      createdAtUtc: record.createdAtUtc,
      updatedAtUtc: record.updatedAtUtc,
      capability: cap,
    };
  }
}
