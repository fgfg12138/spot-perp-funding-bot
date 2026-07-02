/**
 * Master Key Provider — Phase 5 API Key 加密主密钥管理。
 *
 * 从 runtimeConfig 获取主密钥（源自 V121_MASTER_KEY 环境变量）。
 * 主密钥仅在服务端使用，永远不暴露给前端。
 */

import { getMasterKey as getMasterKeyFromConfig } from "../config/runtimeConfig";

let cachedMasterKey: string | undefined;

/**
 * 获取主密钥。
 *
 * 首次调用时从 runtimeConfig 读取并缓存。
 * 后续调用返回缓存值。
 *
 * @returns 主密钥字符串，若未设置则抛错。
 * @throws Error 当 V121_MASTER_KEY 未设置时。
 */
export function getMasterKey(): string {
  if (cachedMasterKey !== undefined) return cachedMasterKey;

  const key = getMasterKeyFromConfig();
  if (!key || key.trim().length < 16) {
    throw new Error(
      "V121_MASTER_KEY 未设置或长度不足（至少 16 字符）。" +
      "请设置环境变量 V121_MASTER_KEY 后再添加交易所账户。",
    );
  }

  cachedMasterKey = key.trim();
  return cachedMasterKey;
}

/**
 * 检查主密钥是否已配置（不抛错）。
 */
export function isMasterKeyConfigured(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * 重置缓存（仅用于测试）。
 */
export function resetMasterKeyCache(): void {
  cachedMasterKey = undefined;
}
