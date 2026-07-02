/**
 * safeFetch — 带超时和错误分类的 HTTP 请求包装。
 *
 * 不泄露 API Key / Secret / Passphrase / Signature / Auth headers。
 */

export type SafeFetchErrorType =
  | "env_not_configured"
  | "network_error"
  | "auth_or_permission_error"
  | "endpoint_not_found"
  | "rate_limited"
  | "exchange_business_error"
  | "timeout"
  | "not_implemented"
  | "unknown_error";

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  body?: any;
  errorType?: SafeFetchErrorType;
  errorMessage?: string;
  latencyMs?: number;
}

const TIMEOUT_MS = 10_000;

export async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<SafeFetchResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;
    let body: any;
    try { body = await res.json(); } catch { try { body = await res.text(); } catch { body = null; } }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false, status: res.status, body,
        errorType: "auth_or_permission_error",
        errorMessage: `API Key、签名、权限或 IP 白名单可能存在问题（HTTP ${res.status}）。请检查交易所 API 设置。`,
        latencyMs,
      };
    }
    if (res.status === 404) {
      return {
        ok: false, status: res.status, body,
        errorType: "endpoint_not_found",
        errorMessage: "接口路径可能错误或该账户类型不支持。",
        latencyMs,
      };
    }
    if (res.status === 429) {
      return {
        ok: false, status: res.status, body,
        errorType: "rate_limited",
        errorMessage: "请求过于频繁，被交易所限流。请稍后重试。",
        latencyMs,
      };
    }
    if (!res.ok) {
      return {
        ok: false, status: res.status, body,
        errorType: "exchange_business_error",
        errorMessage: `交易所返回错误 (HTTP ${res.status})`,
        latencyMs,
      };
    }

    return { ok: true, status: res.status, body, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.name === "AbortError") {
      return {
        ok: false,
        errorType: "timeout",
        errorMessage: "连接超时（超过 10 秒）",
        latencyMs,
      };
    }
    const m = (err.message ?? "").toLowerCase();
    if (m.includes("fetch failed") || m.includes("enotfound") ||
        m.includes("econnrefused") || m.includes("econnreset")) {
      return {
        ok: false,
        errorType: "network_error",
        errorMessage: "网络连接失败，请检查网络或代理设置",
        latencyMs,
      };
    }
    return {
      ok: false,
      errorType: "unknown_error",
      errorMessage: `未知错误: ${err.message}`,
      latencyMs,
    };
  }
}
