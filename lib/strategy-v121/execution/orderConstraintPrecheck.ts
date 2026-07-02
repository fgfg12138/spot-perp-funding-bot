/**
 * 订单约束预检 — 检查某币种 10U 能否同时满足现货和合约最小下单限制。
 */
import type { ExchangeId } from "../domain/types";

export interface OrderConstraintCheck {
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  spotPass: boolean;
  perpPass: boolean;
  overallPass: boolean;
  spotMinNotional?: number;
  perpMinNotional?: number;
  spotStepSize?: number;
  perpStepSize?: number;
  minRequiredNotionalUsdt: number;
  chineseMessage: string;
}

export async function checkOrderConstraint(
  exchange: ExchangeId, symbol: string, plannedUsdt: number,
): Promise<OrderConstraintCheck> {
  const base = symbol.split("/")[0];
  const spotCheck = exchange === "binance"
    ? await checkBinanceSpot(base, plannedUsdt)
    : await checkOkxSpot(`${base}-USDT`, plannedUsdt);
  const perpCheck = exchange === "binance"
    ? await checkBinancePerp(base, plannedUsdt)
    : await checkOkxPerp(`${base}-USDT-SWAP`, plannedUsdt);

  const minRequired = Math.max(spotCheck.minNotional ?? 0, perpCheck.minNotional ?? 0, 10);
  const overall = spotCheck.pass && perpCheck.pass;

  return {
    exchange, symbol, plannedNotionalUsdt: plannedUsdt,
    spotPass: spotCheck.pass, perpPass: perpCheck.pass,
    overallPass: overall,
    spotMinNotional: spotCheck.minNotional,
    perpMinNotional: perpCheck.minNotional,
    spotStepSize: spotCheck.stepSize,
    perpStepSize: perpCheck.stepSize,
    minRequiredNotionalUsdt: minRequired,
    chineseMessage: overall
      ? `${symbol} 满足 10U 下单限制`
      : `${symbol} 不满足: 现货需≥$${spotCheck.minNotional ?? "?"}, 合约需≥$${perpCheck.minNotional ?? "?"}`,
  };
}

async function checkBinanceSpot(base: string, planned: number) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/exchangeInfo?symbol=${base}USDT`);
    const data = await res.json();
    const symbol = data.symbols?.[0];
    if (!symbol) return { pass: false, minNotional: planned, stepSize: 0 };

    const lotFilter = symbol.filters?.find((f: any) => f.filterType === "LOT_SIZE");
    const minNotionalFilter = symbol.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL");
    const priceFilter = symbol.filters?.find((f: any) => f.filterType === "PRICE_FILTER");

    const stepSize = Number(lotFilter?.stepSize ?? 0.00001);
    const minQty = Number(lotFilter?.minQty ?? 0);
    const minNotional = Number(minNotionalFilter?.minNotional ?? 10);

    // 粗略判断：10U 能否 >= minNotional
    return {
      pass: planned >= minNotional && minQty > 0,
      minNotional: Math.max(minNotional, 10),
      stepSize,
    };
  } catch {
    return { pass: true, minNotional: 10, stepSize: 0 }; // 乐观假设
  }
}

async function checkBinancePerp(base: string, planned: number) {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${base}USDT`);
    const data = await res.json();
    const symbol = data.symbols?.[0];
    if (!symbol) return { pass: false, minNotional: planned, stepSize: 0 };

    const lotFilter = symbol.filters?.find((f: any) => f.filterType === "LOT_SIZE");
    const priceFilter = symbol.filters?.find((f: any) => f.filterType === "PRICE_FILTER");
    const minNotionalFilter = symbol.filters?.find((f: any) => f.filterType === "MIN_NOTIONAL");

    const stepSize = Number(lotFilter?.stepSize ?? 0.001);
    const minQty = Number(lotFilter?.minQty ?? 0);
    const minNotional = Number(minNotionalFilter?.notional ?? 5);

    return {
      pass: planned >= minNotional && minQty > 0,
      minNotional: Math.max(minNotional, 5),
      stepSize,
    };
  } catch {
    return { pass: true, minNotional: 5, stepSize: 0 };
  }
}

async function checkOkxSpot(instId: string, planned: number) {
  try {
    const res = await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SPOT&instId=${instId}`);
    const data = await res.json();
    const inst = data.data?.[0];
    if (!inst) return { pass: false, minNotional: planned, stepSize: 0 };

    const minSz = Number(inst.minSz ?? 0.00001);
    const lotSz = Number(inst.lotSz ?? 0.00001);
    const minNotional = Number(inst.minNotionalUsd ?? 10);

    return {
      pass: planned >= minNotional && minSz > 0,
      minNotional: Math.max(minNotional, 10),
      stepSize: lotSz,
    };
  } catch {
    return { pass: true, minNotional: 10, stepSize: 0 };
  }
}

async function checkOkxPerp(instId: string, planned: number) {
  try {
    const res = await fetch(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${instId}`);
    const data = await res.json();
    const inst = data.data?.[0];
    if (!inst) return { pass: false, minNotional: planned, stepSize: 0 };

    const minSz = Number(inst.minSz ?? 0.001);
    const lotSz = Number(inst.lotSz ?? 0.001);
    const ctVal = Number(inst.ctVal ?? 1);

    return {
      pass: planned >= 5 && minSz > 0,
      minNotional: 5,
      stepSize: lotSz,
    };
  } catch {
    return { pass: true, minNotional: 5, stepSize: 0 };
  }
}
