import type { ExchangeId } from "../domain/types";
import { isApiKeyConfigured } from "./shadowAccountService";
import { safeFetch } from "./adapters/safeFetch";
import { binanceSign, okxSign, htxSign, utcTimestampMs } from "./adapters/accountSigning";
import type { SafeFetchErrorType } from "./adapters/safeFetch";

export type DiagnosticOperation =
  | "spot_balance" | "futures_position" | "open_orders"
  | "account_balance" | "positions" | "pending_orders"
  | "swap_position";

export interface DiagnosticResult {
  exchange: ExchangeId;
  operation: DiagnosticOperation;
  envConfigured: boolean;
  success: boolean;
  errorType?: SafeFetchErrorType;
  httpStatus?: number;
  exchangeCode?: string;
  exchangeMessage?: string;
  chineseMessage: string;
  latencyMs?: number;
}

const SPOT = "https://api.binance.com";
const FUTURES = "https://fapi.binance.com";
const OKX = "https://www.okx.com";
const HTX_SPOT = "https://api.huobi.pro";
const HTX_SWAP = "https://api.hbdm.com";

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  results.push(await diagBinanceSpotBalance());
  results.push(await diagBinanceFuturesPosition());
  results.push(await diagBinanceOpenOrders());
  results.push(await diagOkxBalance());
  results.push(await diagOkxPositions());
  results.push(await diagOkxPendingOrders());
  results.push(await diagHtxSpotBalance());
  results.push(await diagHtxSwapPosition());
  results.push({
    exchange: "htx", operation: "open_orders",
    envConfigured: isApiKeyConfigured("htx"),
    success: false, errorType: "not_implemented",
    chineseMessage: "HTX 挂单读取暂未实现",
    latencyMs: 0,
  });

  return results;
}

async function signedRun(
  fn: () => Promise<{ ok: boolean; status?: number; body?: any; errorType?: SafeFetchErrorType; errorMessage?: string; latencyMs?: number }>,
): Promise<DiagnosticResult["success"] extends true ? any : any> {
  try {
    const r = await fn();
    if (r.ok) return { success: true, chineseMessage: "读取成功", latencyMs: r.latencyMs };
    return { success: false, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "未知错误", latencyMs: r.latencyMs };
  } catch (err: any) {
    return { success: false, errorType: "unknown_error", chineseMessage: err.message, latencyMs: 0 };
  }
}

async function diagBinanceSpotBalance(): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("binance");
  if (!envOk) return { exchange: "binance", operation: "spot_balance", envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 Binance API Key", latencyMs: 0 };
  const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
  const { signature, apiKey } = binanceSign(query);
  const r = await safeFetch(`${SPOT}/api/v3/account?${query}&signature=${signature}`, { headers: { "X-MBX-APIKEY": apiKey } });
  return { exchange: "binance", operation: "spot_balance", envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs };
}

async function diagBinanceFuturesPosition(): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("binance");
  if (!envOk) return { exchange: "binance", operation: "futures_position", envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 Binance API Key", latencyMs: 0 };
  const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
  const { signature, apiKey } = binanceSign(query);
  const r = await safeFetch(`${FUTURES}/fapi/v2/positionRisk?${query}&signature=${signature}`, { headers: { "X-MBX-APIKEY": apiKey } });
  return { exchange: "binance", operation: "futures_position", envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs };
}

async function diagBinanceOpenOrders(): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("binance");
  if (!envOk) return { exchange: "binance", operation: "open_orders", envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 Binance API Key", latencyMs: 0 };
  const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
  const { signature, apiKey } = binanceSign(query);
  const r = await safeFetch(`${FUTURES}/fapi/v1/openOrders?${query}&signature=${signature}`, { headers: { "X-MBX-APIKEY": apiKey } });
  return { exchange: "binance", operation: "open_orders", envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs };
}

function okxDiag(path: string): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("okx");
  const op: DiagnosticOperation = path.includes("balance") ? "account_balance" : path.includes("orders") ? "pending_orders" : "positions";
  if (!envOk) return Promise.resolve({ exchange: "okx", operation: op, envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 OKX API Key", latencyMs: 0 });
  const ts = new Date().toISOString();
  const { apiKey, passphrase, sign } = okxSign(ts, "GET", path, "");
  return safeFetch(`${OKX}${path}`, {
    headers: { "OK-ACCESS-KEY": apiKey, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": passphrase, "Content-Type": "application/json" },
  }).then(r => ({ exchange: "okx" as ExchangeId, operation: op, envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs }));
}

async function diagOkxBalance() { return okxDiag("/api/v5/account/balance"); }
async function diagOkxPositions() { return okxDiag("/api/v5/account/positions"); }
async function diagOkxPendingOrders() { return okxDiag("/api/v5/trade/orders-pending"); }

async function diagHtxSpotBalance(): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("htx");
  if (!envOk) return { exchange: "htx", operation: "spot_balance", envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 HTX API Key", latencyMs: 0 };
  const now = new Date();
  const ts = now.toISOString().replace(/\.\d{3}Z$/, "");
  const params = { Timestamp: ts };
  const host = new URL(HTX_SPOT).host;
  const signed = htxSign("GET", host, "/v1/account/accounts", params);
  const qs = Object.entries(signed).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const r = await safeFetch(`${HTX_SPOT}/v1/account/accounts?${qs}`);
  return { exchange: "htx", operation: "spot_balance", envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs };
}

async function diagHtxSwapPosition(): Promise<DiagnosticResult> {
  const envOk = isApiKeyConfigured("htx");
  if (!envOk) return { exchange: "htx", operation: "swap_position", envConfigured: false, success: false, errorType: "env_not_configured", chineseMessage: "未配置 HTX API Key", latencyMs: 0 };
  const now = new Date();
  const ts = now.toISOString().replace(/\.\d{3}Z$/, "");
  const params = { Timestamp: ts };
  const host = new URL(HTX_SWAP).host;
  const signed = htxSign("POST", host, "/linear-swap-api/v1/swap_account_info", params);
  const qs = Object.entries(signed).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const r = await safeFetch(`${HTX_SWAP}/linear-swap-api/v1/swap_account_info?${qs}`, { method: "POST" });
  return { exchange: "htx", operation: "swap_position", envConfigured: true, success: r.ok, errorType: r.errorType, httpStatus: r.status, chineseMessage: r.errorMessage ?? "读取成功", latencyMs: r.latencyMs };
}
