import type { OrderBookLevel, VwapResult } from "../domain/types";

/**
 * 计算买入 VWAP（吃卖盘）
 * 模拟按名义金额买入，逐级吃掉 ask 盘口
 */
export function calcBuyVwap(asks: OrderBookLevel[], notional: number): VwapResult {
  if (asks.length === 0 || notional <= 0) {
    return { avgPrice: 0, filledQty: 0, filledNotional: 0, slippageRate: 0, isFullyFillable: false };
  }

  let remaining = notional;
  let totalQty = 0;
  let totalNotional = 0;

  for (const level of asks) {
    if (remaining <= 0) break;
    const costAtLevel = level.price * level.qty;
    if (costAtLevel <= remaining) {
      totalQty += level.qty;
      totalNotional += costAtLevel;
      remaining -= costAtLevel;
    } else {
      const partialQty = remaining / level.price;
      totalQty += partialQty;
      totalNotional += remaining;
      remaining = 0;
    }
  }

  const avgPrice = totalQty > 0 ? totalNotional / totalQty : 0;
  const isFullyFillable = remaining <= 0;
  const midPrice = asks.length > 0 ? asks[0].price : 0;
  const slippageRate = midPrice > 0 ? (avgPrice - midPrice) / midPrice : 0;

  return { avgPrice, filledQty: totalQty, filledNotional: totalNotional, slippageRate, isFullyFillable };
}

/**
 * 计算卖出 VWAP（吃买盘）
 * 模拟按币数量卖出，逐级吃掉 bid 盘口
 */
export function calcSellVwap(bids: OrderBookLevel[], qty: number): VwapResult {
  if (bids.length === 0 || qty <= 0) {
    return { avgPrice: 0, filledQty: 0, filledNotional: 0, slippageRate: 0, isFullyFillable: false };
  }

  let remaining = qty;
  let totalQty = 0;
  let totalNotional = 0;

  for (const level of bids) {
    if (remaining <= 0) break;
    const qtyAtLevel = Math.min(level.qty, remaining);
    totalQty += qtyAtLevel;
    totalNotional += qtyAtLevel * level.price;
    remaining -= qtyAtLevel;
  }

  const avgPrice = totalQty > 0 ? totalNotional / totalQty : 0;
  const isFullyFillable = remaining <= 0;
  const midPrice = bids.length > 0 ? bids[0].price : 0;
  const slippageRate = midPrice > 0 ? (avgPrice - midPrice) / midPrice : 0;

  return { avgPrice, filledQty: totalQty, filledNotional: totalNotional, slippageRate, isFullyFillable };
}
