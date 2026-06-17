import type { ExchangeId } from "../domain/types";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";
import { isApiKeyConfigured } from "../account/shadowAccountService";

export interface CapitalPrecheckResult {
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  spotFreeUsdt: number;
  perpFreeUsdt: number;
  spotRequiredUsdt: number;
  perpRequiredMarginUsdt: number;
  feeBufferUsdt: number;
  safetyReserveUsdt: number;
  maxFeasibleNotionalUsdt: number;
  minRequiredNotionalUsdt: number;
  pass: boolean;
  blockReason?: string;
  canSuggestReducedSize: boolean;
  suggestedNotionalUsdt?: number;
  realExecutionAllowed: false;
  chineseMessage: string;
}

const FEE_BUFFER_RATE = 0.002;
const SAFETY_RESERVE_RATE = 0.01;

async function readFuturesBalance(exchange: ExchangeId): Promise<number | null> {
  try {
    if (exchange === "binance") {
      const { binanceSign, utcTimestampMs } = await import("../account/adapters/accountSigning");
      const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
      const { signature, apiKey } = binanceSign(query);
      const res = await fetch(`https://fapi.binance.com/fapi/v2/account?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const data = await res.json();
      return Number(data.availableBalance ?? data.totalWalletBalance ?? 0);
    }
    if (exchange === "okx") {
      const { okxSign } = await import("../account/adapters/accountSigning");
      const ts = new Date().toISOString();
      const { apiKey, passphrase, sign } = okxSign(ts, "GET", "/api/v5/account/balance", "");
      const res = await fetch("https://www.okx.com/api/v5/account/balance", {
        headers: { "OK-ACCESS-KEY": apiKey, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": passphrase, "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (body.code !== "0") return null;
      const details = body.data?.[0]?.details ?? [];
      const usdt = details.find((d: any) => d.ccy === "USDT");
      return usdt ? Number(usdt.cashBal ?? usdt.availBal ?? 0) : 0;
    }
    return null;
  } catch { return null; }
}

export async function runCapitalPrecheck(
  exchange: ExchangeId, symbol: string, plannedNotionalUsdt: number,
): Promise<CapitalPrecheckResult> {
  const noAccess = (reason: string): CapitalPrecheckResult => ({
    exchange, symbol, plannedNotionalUsdt,
    spotFreeUsdt: 0, perpFreeUsdt: 0, spotRequiredUsdt: 0, perpRequiredMarginUsdt: 0,
    feeBufferUsdt: 0, safetyReserveUsdt: 0,
    maxFeasibleNotionalUsdt: 0, minRequiredNotionalUsdt: 10,
    pass: false, blockReason: reason, canSuggestReducedSize: false,
    realExecutionAllowed: false, chineseMessage: `资金预检失败: ${reason}`,
  });

  if (!isApiKeyConfigured(exchange)) {
    return noAccess(`${exchange} API Key 未配置`);
  }

  // 读现货余额
  const { adapter } = createAccountAdapter(exchange);
  let spotFree = 0;
  try {
    const balances = await adapter.fetchBalances();
    const usdt = balances.find(b => b.asset === "USDT");
    if (usdt) spotFree = usdt.free;
  } catch {
    return noAccess("无法读取现货账户余额");
  }

  // 读合约可用保证金 — 不能估算
  const perpFree = await readFuturesBalance(exchange);
  if (perpFree === null) {
    return noAccess("无法读取合约账户可用保证金，禁止进入真实执行");
  }

  const feeBuffer = plannedNotionalUsdt * FEE_BUFFER_RATE;
  const safetyReserve = plannedNotionalUsdt * SAFETY_RESERVE_RATE;
  const spotRequired = plannedNotionalUsdt + feeBuffer + safetyReserve;
  const perpRequired = plannedNotionalUsdt + feeBuffer + safetyReserve;
  const maxFeasible = Math.min(
    Math.max(0, spotFree - safetyReserve - feeBuffer),
    Math.max(0, perpFree - safetyReserve - feeBuffer),
  );
  const minRequired = 10;
  const allowDownsize = process.env.V121_ALLOW_AUTO_DOWNSIZE === "true";

  if (spotFree < spotRequired) {
    return noAccess(`现货 USDT 不足: 可用 ${spotFree.toFixed(2)}U，需 ${spotRequired.toFixed(2)}U`);
  }
  if (perpFree < perpRequired) {
    return noAccess(`合约保证金不足: 可用 ${perpFree.toFixed(2)}U，需 ${perpRequired.toFixed(2)}U`);
  }
  if (maxFeasible < minRequired) {
    return noAccess(`最大可行 ${maxFeasible.toFixed(2)}U < 最小要求 ${minRequired}U`);
  }

  if (maxFeasible < plannedNotionalUsdt) {
    const suggested = Math.floor(maxFeasible);
    if (allowDownsize) {
      return {
        exchange, symbol, plannedNotionalUsdt,
        spotFreeUsdt: spotFree, perpFreeUsdt: perpFree,
        spotRequiredUsdt: spotRequired, perpRequiredMarginUsdt: perpRequired,
        feeBufferUsdt: feeBuffer, safetyReserveUsdt: safetyReserve,
        maxFeasibleNotionalUsdt: maxFeasible, minRequiredNotionalUsdt: minRequired,
        pass: false,
        blockReason: `资金不足计划 ${plannedNotionalUsdt}U，建议降为 ${suggested}U（需人工确认并重新审计）`,
        canSuggestReducedSize: true, suggestedNotionalUsdt: suggested,
        realExecutionAllowed: false,
        chineseMessage: `资金不足，建议降为 ${suggested}U 后重新审计`,
      };
    }
    return noAccess(`资金不足: 计划 ${plannedNotionalUsdt}U，最多 ${maxFeasible.toFixed(2)}U。不允许自动缩仓。`);
  }

  return {
    exchange, symbol, plannedNotionalUsdt,
    spotFreeUsdt: spotFree, perpFreeUsdt: perpFree,
    spotRequiredUsdt: spotRequired, perpRequiredMarginUsdt: perpRequired,
    feeBufferUsdt: feeBuffer, safetyReserveUsdt: safetyReserve,
    maxFeasibleNotionalUsdt: maxFeasible, minRequiredNotionalUsdt: minRequired,
    pass: true,
    canSuggestReducedSize: false, realExecutionAllowed: false,
    chineseMessage: `资金预检通过: 现货 ${spotFree.toFixed(2)}U，合约 ${perpFree.toFixed(2)}U`,
  };
}
