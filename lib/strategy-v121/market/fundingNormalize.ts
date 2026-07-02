/**
 * Funding rate normalization.
 *
 * Different exchanges may report funding at different intervals
 * (1h, 4h, 8h). All rates must be normalized to 8h equivalent
 * for fair comparison.
 *
 * Formula: funding8h = fundingRate * (8 / intervalHours)
 */

/**
 * Normalize funding rate to 8-hour equivalent.
 *
 * @param fundingRate - Raw funding rate from exchange (decimal)
 * @param intervalHours - Funding interval in hours (1, 4, or 8)
 * @returns 8-hour equivalent funding rate
 */
export function normalizeFunding8h(fundingRate: number, intervalHours: number): number {
  if (intervalHours <= 0) return fundingRate;
  return fundingRate * (8 / intervalHours);
}

/**
 * Standard funding intervals by exchange.
 */
export const FUNDING_INTERVALS: Record<string, number> = {
  binance: 8,
  okx: 8,
  htx: 8,
};

/**
 * Check if a funding rate is abnormally high.
 */
export function classifyFundingLevel(funding8h: number): {
  level: "normal" | "elevated" | "abnormal" | "extreme" | "blacklist";
  canOpen: boolean;
} {
  if (funding8h > 0.01) return { level: "blacklist", canOpen: false };
  if (funding8h > 0.005) return { level: "extreme", canOpen: false };
  if (funding8h > 0.003) return { level: "abnormal", canOpen: false };
  if (funding8h > 0.001) return { level: "elevated", canOpen: true };
  return { level: "normal", canOpen: true };
}
