import type { ExchangeId } from "../domain/types";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";

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

export async function runCapitalPrecheck(
  exchange: ExchangeId, symbol: string, plannedNotionalUsdt: number,
): Promise<CapitalPrecheckResult> {
  const { adapter } = createAccountAdapter(exchange);

  let spotFree = 0;
  let perpFree = 0;

  try {
    const balances = await adapter.fetchBalances();
    const usdt = balances.find(b => b.asset === "USDT");
    if (usdt) {
      spotFree = usdt.free;
      perpFree = usdt.free * 0.5; // 合约侧保守估算
    }
  } catch {
    return fail(exchange, symbol, plannedNotionalUsdt, "无法读取账户余额，请确认 API Key 已配置");
  }

  const feeBuffer = plannedNotionalUsdt * FEE_BUFFER_RATE;
  const safetyReserve = plannedNotionalUsdt * SAFETY_RESERVE_RATE;
  const spotRequired = plannedNotionalUsdt + feeBuffer + safetyReserve;
  const perpRequired = plannedNotionalUsdt + feeBuffer + safetyReserve;

  const maxFeasibleSpot = Math.max(0, spotFree - safetyReserve - feeBuffer);
  const maxFeasiblePerp = Math.max(0, perpFree - safetyReserve - feeBuffer);
  const maxFeasible = Math.min(maxFeasibleSpot, maxFeasiblePerp);
  const minRequired = 10;
  const allowDownsize = process.env.V121_ALLOW_AUTO_DOWNSIZE === "true";

  if (spotFree < spotRequired) {
    return failDetail(exchange, symbol, plannedNotionalUsdt, spotFree, perpFree, spotRequired, perpRequired, feeBuffer, safetyReserve, maxFeasible, minRequired,
      `现货 USDT 不足: 可用 ${spotFree.toFixed(2)}U，需 ${spotRequired.toFixed(2)}U`);
  }
  if (perpFree < perpRequired) {
    return failDetail(exchange, symbol, plannedNotionalUsdt, spotFree, perpFree, spotRequired, perpRequired, feeBuffer, safetyReserve, maxFeasible, minRequired,
      `合约保证金不足: 可用 ${perpFree.toFixed(2)}U，需 ${perpRequired.toFixed(2)}U`);
  }
  if (maxFeasible < minRequired) {
    return failDetail(exchange, symbol, plannedNotionalUsdt, spotFree, perpFree, spotRequired, perpRequired, feeBuffer, safetyReserve, maxFeasible, minRequired,
      `最大可行 ${maxFeasible.toFixed(2)}U < 最小要求 ${minRequired}U`);
  }

  if (maxFeasible < plannedNotionalUsdt) {
    if (allowDownsize) {
      const suggested = Math.floor(maxFeasible);
      return failDetail(exchange, symbol, plannedNotionalUsdt, spotFree, perpFree, spotRequired, perpRequired, feeBuffer, safetyReserve, maxFeasible, minRequired,
        `资金不足原计划 ${plannedNotionalUsdt}U，建议降为 ${suggested}U（需人工确认）`, suggested);
    }
    return failDetail(exchange, symbol, plannedNotionalUsdt, spotFree, perpFree, spotRequired, perpRequired, feeBuffer, safetyReserve, maxFeasible, minRequired,
      `资金不足: 计划 ${plannedNotionalUsdt}U，最多 ${maxFeasible.toFixed(2)}U。不允许自动缩仓。`);
  }

  return {
    exchange, symbol, plannedNotionalUsdt,
    spotFreeUsdt: spotFree, perpFreeUsdt: perpFree,
    spotRequiredUsdt: spotRequired, perpRequiredMarginUsdt: perpRequired,
    feeBufferUsdt: feeBuffer, safetyReserveUsdt: safetyReserve,
    maxFeasibleNotionalUsdt: maxFeasible, minRequiredNotionalUsdt: minRequired,
    pass: true,
    canSuggestReducedSize: false, realExecutionAllowed: false,
    chineseMessage: `资金预检通过: 现货 ${spotFree.toFixed(2)}U，合约 ${perpFree.toFixed(2)}U，计划 ${plannedNotionalUsdt}U`,
  };
}

function fail(exchange: ExchangeId, symbol: string, planned: number, reason: string): CapitalPrecheckResult {
  return {
    exchange, symbol, plannedNotionalUsdt: planned,
    spotFreeUsdt: 0, perpFreeUsdt: 0, spotRequiredUsdt: 0, perpRequiredMarginUsdt: 0,
    feeBufferUsdt: 0, safetyReserveUsdt: 0,
    maxFeasibleNotionalUsdt: 0, minRequiredNotionalUsdt: 10,
    pass: false, blockReason: reason,
    canSuggestReducedSize: false, realExecutionAllowed: false,
    chineseMessage: `资金预检失败: ${reason}`,
  };
}

function failDetail(
  exchange: ExchangeId, symbol: string, planned: number,
  spotFree: number, perpFree: number, spotReq: number, perpReq: number,
  feeBuf: number, safetyReserve: number, maxFeasible: number, minRequired: number,
  reason: string, suggested?: number,
): CapitalPrecheckResult {
  return {
    exchange, symbol, plannedNotionalUsdt: planned,
    spotFreeUsdt: spotFree, perpFreeUsdt: perpFree,
    spotRequiredUsdt: spotReq, perpRequiredMarginUsdt: perpReq,
    feeBufferUsdt: feeBuf, safetyReserveUsdt: safetyReserve,
    maxFeasibleNotionalUsdt: maxFeasible, minRequiredNotionalUsdt: minRequired,
    pass: false, blockReason: reason,
    canSuggestReducedSize: !(reason.includes("不允许自动缩仓")) && maxFeasible >= minRequired,
    suggestedNotionalUsdt: suggested,
    realExecutionAllowed: false,
    chineseMessage: `资金预检未通过: ${reason}`,
  };
}
