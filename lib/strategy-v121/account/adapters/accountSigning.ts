/**
 * API 请求签名工具 — 仅服务端使用。
 *
 * 从 process.env 读取密钥，生成 HMAC 签名。
 * 不将密钥返回给调用方，不写入日志，不暴露到前端。
 */

import * as crypto from "node:crypto";

function getEnvOrThrow(name: string): string {
  const val = process.env[name];
  if (!val || val.length === 0) {
    throw new Error(`缺少环境变量 ${name}。请在 .env.local 中配置。`);
  }
  return val;
}

/**
 * Binance 签名：query string → HMAC-SHA256 hex
 */
export function binanceSign(queryString: string): { signature: string; apiKey: string } {
  const secret = getEnvOrThrow("BINANCE_API_SECRET");
  const apiKey = getEnvOrThrow("BINANCE_API_KEY");
  const signature = crypto.createHmac("sha256", secret).update(queryString).digest("hex");
  return { signature, apiKey };
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
  const secret = getEnvOrThrow("OKX_API_SECRET");
  const apiKey = getEnvOrThrow("OKX_API_KEY");
  const passphrase = getEnvOrThrow("OKX_PASSPHRASE");
  const message = timestamp + method + requestPath + body;
  const sign = crypto.createHmac("sha256", secret).update(message).digest("base64");
  return { apiKey, passphrase, timestamp, sign };
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
  const secret = getEnvOrThrow("HTX_API_SECRET");
  const accessKey = getEnvOrThrow("HTX_API_KEY");

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
