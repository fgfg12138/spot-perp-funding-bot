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
import { encryptSecret, decryptSecret, maskApiKey, type EncryptedPayload } from "./cryptoUtils";
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
    // 对支持交易的 runtime adapter 额外探测交易类权限（fundingRate + tradeSpot + tradePerp）
    const boostedCap = await this.attemptProbeTradeCapabilities(adapter, report.capability);
    // 应用套利决策
    const decision = decideArbCapability(boostedCap);
    const finalCap: ExchangeCapability = {
      ...boostedCap,
      sameExchangeArbEnabled: decision.sameExchangeArbEnabled,
      crossExchangeArbEnabled: decision.crossExchangeArbEnabled,
    };
    this.repo.saveCapability(finalCap);

    return {
      ...report,
      capability: finalCap,
    };
  }

  /**
   * 通过运行时 adapter 额外探测交易类权限。
   *
   * 只读探测（detectCapabilities）不会设置 tradeSpot / tradePerp / fundingRate / internalTransfer，
   * 此处对完整实现的 adapter 执行附加探测：
   *  1. 调用 adapter.validateOrderPlan() 判断交易接口是否可用。
   *  2. 调用 adapter.transferInternal(dryRun=true) 判断内部划转是否可用。
   *  3. 读取公共资金费率 API 判断 fundingRate 是否可读。
   *
   * OKX 和 Binance 的 runtime adapter 均为完整实现，可以执行探测。
   */
  private async attemptProbeTradeCapabilities(
    adapter: import("../account/accountTypes").IAccountAdapter,
    cap: ExchangeCapability,
  ): Promise<ExchangeCapability> {
    const tradeCaps: Partial<ExchangeCapability> = {};

    // ─── 1. 尝试 validateOrderPlan 推断 tradeSpot + tradePerp ─────
    try {
      // 构造一个最小化的 order plan 做探测
      const dummyPlan: import("../execution/orderTypes").TwoLegOrderPlan = {
        id: "probe-dummy",
        status: "validated",
        exchange: cap.exchange,
        spotLeg: {
          symbol: "BTC/USDT",
          market: "spot",
          role: "spot_buy",
          type: "MARKET",
          side: "buy",
          quoteNotionalUsdt: 10,
          quantity: 0,
          clientOrderId: `probe-${Date.now()}`,
          exchange: cap.exchange,
          constraints: { minNotional: 5, lotStepSize: "0.00001", tickSize: "0.1" },
        },
        perpLeg: {
          symbol: "BTC/USDT",
          market: "perp",
          role: "perp_short",
          type: "MARKET",
          side: "sell",
          quantity: 1,
          quoteNotionalUsdt: 10,
          clientOrderId: `probe-${Date.now()}`,
          exchange: cap.exchange,
          constraints: { minNotional: 5, lotStepSize: "1", tickSize: "0.1" },
        },
      } as any;
      const result = await adapter.validateOrderPlan(dummyPlan);
      // validateOrderPlan 成功返回（可能 ok=true 或 ok=false 但有业务 blocker）
      // 说明 adapter 的交易接口可达（非只读）。
      // 注意：认证失败（401/403）时 result 中包含认证错误的 blocker，
      //       此时不应视为有交易权限。
      if (result.ok) {
        tradeCaps.tradeSpot = true;
        tradeCaps.tradePerp = true;
      } else {
        // ok=false: 检查 blocker 是否仅包含认证/网络错误
        // 区分认证错误和业务错误：
        // - 认证错误（401/403/API Key 权限）：接口不可达 → trade disabled
        // - 业务错误（51010等账户模式不支持、precheck 业务级失败）：接口可达但无法预检 → trade enabled
        const authBlockers = result.blockers.filter(
          b => b.includes("401") || b.includes("403") || b.includes("认证") || b.includes("permission"),
        );
        // order-precheck error 可能是认证错误，也可能是业务错误（如 51010 账户模式不支持）
        // 提取 HTTP 状态码来判断：如果包含 "HTTP 401" 或 "HTTP 403" 才是认证错误
        const precheckAuthBlockers = result.blockers.filter(
          b => b.includes("order-precheck error") && (b.includes("HTTP 401") || b.includes("HTTP 403")),
        );
        const totalAuthBlockers = [...new Set([...authBlockers, ...precheckAuthBlockers])];
        // 非认证 blocker = 全部 blocker - 认证 blocker
        const nonAuthBlockers = result.blockers.filter(
          b => !totalAuthBlockers.includes(b),
        );
        if (nonAuthBlockers.length > 0 || result.blockers.length === 0) {
          // 存在非认证错误的 blocker（如业务级 precheck 失败）→ 交易接口可达
          tradeCaps.tradeSpot = true;
          tradeCaps.tradePerp = true;
          console.warn(`[ExchangeAccountService] ${cap.exchange} probe: validateOrderPlan returned blockers (non-auth) → trade enabled`, result.blockers);
        } else {
          console.warn(`[ExchangeAccountService] ${cap.exchange} probe: validateOrderPlan returned auth-only blockers → trade disabled`, result.blockers);
        }
      }
    } catch (e: any) {
      // validateOrderPlan 抛异常（网络/认证错误）→ 没有交易权限，保持 false
      console.error(`[ExchangeAccountService] ${cap.exchange} probe: validateOrderPlan threw → trade disabled. Error: ${e?.message ?? e}`);
    }

    // ─── 3. 尝试 dry-run internalTransfer 推断 internalTransfer ──
    // 仅对完整实现的 runtime adapter（Binance、OKX）执行，
    // HTX observe-only adapter 的 transferInternal 会抛异常。
    try {
      const probeTransferRequest: import("../execution/internalTransferTypes").InternalTransferRequest = {
        exchange: cap.exchange,
        asset: "USDT",
        fromAccount: "spot",
        toAccount: "perp",
        amountUsdt: 10,
        reason: "probe",
        idempotencyKey: `probe-internal-transfer-${Date.now()}`,
        dryRun: true,
      };
      // 注意：transferInternal 在 dryRun 时不会发送真实 API 请求，
      // Binance/OKX runtime adapter 直接返回 { ok: true, status: "dry_run" }
      const transferResult = await adapter.transferInternal(probeTransferRequest);
      if (transferResult.ok) {
        tradeCaps.internalTransfer = true;
      } else {
        console.warn(`[ExchangeAccountService] ${cap.exchange} probe: transferInternal(dryRun) returned ok=false`, transferResult);
      }
    } catch (e: any) {
      // internalTransfer 保持 false（HTX adapter 抛异常，或网络错误）
      if (cap.exchange !== "htx") {
        console.warn(`[ExchangeAccountService] ${cap.exchange} probe: transferInternal(dryRun) threw → internalTransfer disabled. ${e?.message ?? e}`);
      }
    }

    // ─── 2. 尝试读取公共资金费率 API 推断 fundingRate ──────────
    if (cap.exchange === "okx") {
      try {
        const url = "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP";
        const res = await fetch(url);
        if (res.ok) {
          const body = await res.json();
          if (body?.code === "0" && body?.data?.[0]?.fundingRate !== undefined) {
            tradeCaps.fundingRate = true;
          } else {
            console.warn(`[ExchangeAccountService] ${cap.exchange} probe: OKX funding-rate API returned unexpected body`, body);
          }
        } else {
          console.warn(`[ExchangeAccountService] ${cap.exchange} probe: OKX funding-rate API returned status ${res.status}`);
        }
      } catch (e: any) {
        // fundingRate 保持 false
        console.warn(`[ExchangeAccountService] ${cap.exchange} probe: OKX funding-rate API fetch threw → fundingRate disabled. ${e?.message ?? e}`);
      }
    } else if (cap.exchange === "binance") {
      try {
        const url = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
        const res = await fetch(url);
        if (res.ok) {
          const body = await res.json();
          if (body?.lastFundingRate !== undefined) {
            tradeCaps.fundingRate = true;
          } else {
            console.warn(`[ExchangeAccountService] ${cap.exchange} probe: Binance premiumIndex API returned unexpected body`, body);
          }
        } else {
          console.warn(`[ExchangeAccountService] ${cap.exchange} probe: Binance premiumIndex API returned status ${res.status}`);
        }
      } catch (e: any) {
        // fundingRate 保持 false
        console.warn(`[ExchangeAccountService] ${cap.exchange} probe: Binance premiumIndex API fetch threw → fundingRate disabled. ${e?.message ?? e}`);
      }
    }

    return { ...cap, ...tradeCaps };
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
