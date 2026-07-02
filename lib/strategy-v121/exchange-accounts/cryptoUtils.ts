/**
 * cryptoUtils — API Key 加密/解密/脱敏工具函数。
 *
 * 替代已删除的 V1 lib/security/apiKeyCrypto 模块，消除外部依赖。
 * 使用 Node.js 内置 crypto 模块（AES-256-GCM + 随机 IV + 认证标签）。
 *
 * 安全：
 *  - 使用 AES-256-GCM 认证加密（防篡改）。
 *  - 每次加密生成随机 16 字节 IV。
 *  - EncryptedPayload 序列化为 JSON 持久化。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ─── 常量 ───────────────────────────────────────────

/** AES-256-GCM 密钥需要 32 字节。 */
const KEY_LENGTH = 32;
/** IV 长度 16 字节。 */
const IV_LENGTH = 16;
/** 认证标签长度 16 字节。 */
const AUTH_TAG_LENGTH = 16;

// ─── 类型 ───────────────────────────────────────────

export interface EncryptedPayload {
  iv: string;          // hex
  encrypted: string;   // hex
  authTag: string;     // hex
}

// ─── 密钥派生 ───────────────────────────────────────

/**
 * 将任意长度的主密钥派生出 AES-256 密钥。
 * 使用 SHA-256 哈希截断到 32 字节。
 */
function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf-8").digest();
}

// ─── 加密 ───────────────────────────────────────────

/**
 * 使用 masterKey 加密明文。
 * 返回 EncryptedPayload（iv + ciphertext + authTag，均为 hex）。
 */
export function encryptSecret(plaintext: string, masterKey: string): EncryptedPayload {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    encrypted: encrypted.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

// ─── 解密 ───────────────────────────────────────────

/**
 * 使用 masterKey 解密 EncryptedPayload。
 * 认证失败时抛出异常。
 */
export function decryptSecret(payload: EncryptedPayload, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = Buffer.from(payload.iv, "hex");
  const encrypted = Buffer.from(payload.encrypted, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted, undefined, "utf-8") + decipher.final("utf-8");
}

// ─── 脱敏 ───────────────────────────────────────────

/**
 * 脱敏 API Key：保留前 4 位和后 4 位，中间用 * 填充。
 *
 * 示例：
 *  "abcdef1234567890"  →  "abcd********7890"
 *  "ab"               →  "ab"（短于 8 位不脱敏）
 */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) return trimmed;
  return trimmed.slice(0, 4) + "*".repeat(trimmed.length - 8) + trimmed.slice(-4);
}
