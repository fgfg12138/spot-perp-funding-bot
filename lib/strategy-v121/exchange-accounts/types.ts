/**
 * Exchange Account 类型定义 — Phase 5 API Key 管理。
 *
 * 与 exchange_accounts / exchange_capabilities 表结构一一对应。
 * 明文 API Key / Secret / Passphrase 永远不通过这些类型暴露给 UI。
 */

import type { ExchangeId } from "../domain/types";

// ─── Exchange Account（加密存储）───────────────────

export interface ExchangeAccountRecord {
  id: string;
  exchange: ExchangeId;
  label: string;
  maskedApiKey: string;
  encryptedApiKeyJson: string;   // JSON string of EncryptedPayload
  encryptedSecretJson: string;   // JSON string of EncryptedPayload
  encryptedPassphraseJson?: string; // OKX only
  enabled: boolean;
  createdAtUtc: string;         // ISO-8601
  updatedAtUtc: string;         // ISO-8601
}

/** 前端提交时的输入（不含已加密字段） */
export interface CreateExchangeAccountInput {
  exchange: ExchangeId;
  label: string;
  apiKey: string;                // 明文，仅服务端短暂持有
  apiSecret: string;             // 明文，仅服务端短暂持有
  passphrase?: string;           // OKX only
}

/** 前端更新 label / enabled 时的输入（不含密钥） */
export interface UpdateExchangeAccountInput {
  label?: string;
  enabled?: boolean;
}

/** 前端可见的账户摘要（无密钥） */
export interface ExchangeAccountSummary {
  id: string;
  exchange: ExchangeId;
  label: string;
  maskedApiKey: string;
  enabled: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  capability?: ExchangeCapability;
}

// ─── Exchange Capability（探测结果）─────────────────

export interface ExchangeCapability {
  accountId: string;
  exchange: ExchangeId;
  readBalance: boolean;
  readSpot: boolean;
  readPerp: boolean;
  tradeSpot: boolean;
  tradePerp: boolean;
  internalTransfer: boolean;
  fundingRate: boolean;
  positions: boolean;
  orders: boolean;
  sameExchangeArbEnabled: boolean;
  crossExchangeArbEnabled: boolean;
  lastCheckedAtUtc?: string;    // ISO-8601
  lastError?: string;
  rawJson?: string;
}

/** 探测过程中每个 probe 的独立结果 */
export interface CapabilityProbeResult {
  probe: string;                // e.g. "fetchBalances"
  success: boolean;
  error?: string;
  durationMs: number;
}

/** 探测的完整输出 */
export interface CapabilityProbeReport {
  accountId: string;
  exchange: ExchangeId;
  probes: CapabilityProbeResult[];
  capability: ExchangeCapability;
  timestampUtc: string;
}
