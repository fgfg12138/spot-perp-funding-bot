import type { OrderBookLevel } from "../domain/types";

/**
 * Calculate available notional within a basis-point depth from mid price.
 * For asks (sell side): depth = sum of price*qty for levels where price <= mid*(1+bps)
 * For bids (buy side): depth = sum of price*qty for levels where price >= mid*(1-bps)
 */
export function calcDepthWithinBps(
  levels: OrderBookLevel[],
  midPrice: number,
  bps: number
): { availableNotional: number; levelCount: number } {
  if (levels.length === 0 || midPrice <= 0) return { availableNotional: 0, levelCount: 0 };

  let available = 0;
  let count = 0;

  for (const level of levels) {
    const deviation = Math.abs(level.price / midPrice - 1);
    if (deviation > bps) break;
    available += level.price * level.qty;
    count++;
  }

  return { availableNotional: available, levelCount: count };
}

/**
 * Check if ask-side depth (spot sell depth) at given bps is sufficient.
 * Returns pass/fail and the available notional.
 */
export function checkSellDepth(
  asks: OrderBookLevel[],
  midPrice: number,
  plannedNotional: number,
  bps: number,
  factor: number
): { passed: boolean; available: number; required: number } {
  const { availableNotional } = calcDepthWithinBps(asks, midPrice, bps);
  const required = plannedNotional * factor;
  return { passed: availableNotional >= required, available: availableNotional, required };
}

/**
 * Check if bid-side depth (perp buy depth) at given bps is sufficient.
 */
export function checkBuyDepth(
  bids: OrderBookLevel[],
  midPrice: number,
  plannedNotional: number,
  bps: number,
  factor: number
): { passed: boolean; available: number; required: number } {
  const { availableNotional } = calcDepthWithinBps(bids, midPrice, bps);
  const required = plannedNotional * factor;
  return { passed: availableNotional >= required, available: availableNotional, required };
}

/**
 * Build OrderBookLevel from raw exchange order book data.
 * Adds `notionalUsdt` field.
 */
export function toOrderBookLevel(price: number, qty: number): OrderBookLevel {
  return { price, qty };
}
