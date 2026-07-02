/**
 * API 请求签名工具 — 仅服务端使用。
 *
 * 从 runtimeConfig 读取密钥，生成 HMAC 签名。
 * 不将密钥返回给调用方，不写入日志，不暴露到前端。
 */

import * as crypto from "node:crypto";
import { getExchangeCredentials } from "../../config/runtimeConfig";

function getCredsOrThrow(exchange: "binance" | "okx" | "htx"): { apiKey: string; apiSecret: string; passphrase?: string } {
  const creds = getExchangeCredentials(exchange);
  if (!creds || !creds.apiKey || !creds.apiSecret) {
    throw new Error(`缺少 ${exchange.toUpperCase()} API 密钥。请在 .env.local 中配置。`);
  }
  if (exchange === "okx" && !creds.passphrase) {
    throw new Error("缺少 OKX PASSPHRASE。请在 .env.local 中配置。");
  }
  return creds;
}

/**
 * Binance 签名：query string → HMAC-SHA256 hex
 */
export function binanceSign(queryString: string): { signature: string; apiKey: string } {
  const creds = getCredsOrThrow("binance");
  const signature = crypto.createHmac("sha256", creds.apiSecret).update(queryString).digest("hex");
  return { signature, apiKey: creds.apiKey };
}

/**
 * OKX 签名：OK-ACCESS-SIGN = Base64(HMAC-SHA256(timestamp + method + path + body))
 * 返回授权头所需字段。不泄露 passphrase 到调用栈外。
 */
export function okxSign(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
): { apiKey: string; passphrase: string; timestamp: string; sign: string } {
  const creds = getCredsOrThrow("okx");
  const message = timestamp + method + requestPath + body;
  const sign = crypto.createHmac("sha256", creds.apiSecret).update(message).digest("base64");
  return { apiKey: creds.apiKey, passphrase: creds.passphrase!, timestamp, sign };
}

/**
 * HTX 签名 (API v2)：HmacSHA256(method + host + path + sortedParams)
 * 返回完整签名参数对象。
 */
export function htxSign(
  method: string,
  host: string,
  path: string,
  params: Record<string, string>,
): Record<string, string> {
  const creds = getCredsOrThrow("htx");

  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  const message = `${method}\n${host}\n${path}\n${paramStr}`;
  const signature = crypto.createHmac("sha256", secret).update(message).digest("base64");

  return {
    ...params,
    AccessKeyId: accessKey,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Signature: signature,
  };
}

/** UTC 时间戳（毫秒），用于 Binance */
export function utcTimestampMs(): number {
  return Date.now();
}
