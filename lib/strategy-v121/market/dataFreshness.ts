import type { MarketSnapshot } from "../domain/types";

/**
 * Check if a market snapshot is fresh enough for trading decisions.
 *
 * @param snapshot - The market snapshot to check
 * @param maxAgeMs - Maximum allowed age in milliseconds (default 10s)
 * @returns Whether the snapshot is fresh
 */
export function isSnapshotFresh(snapshot: MarketSnapshot, maxAgeMs: number = 10000): boolean {
  const ageMs = Date.now() - snapshot.timestampUtc;
  return ageMs <= maxAgeMs;
}

/**
 * Get the age of a snapshot in milliseconds.
 */
export function snapshotAgeMs(snapshot: MarketSnapshot): number {
  return Date.now() - snapshot.timestampUtc;
}

/**
 * Check if the spot spread rate is too wide for trading.
 * Triggers wide-spread downgrade at >0.30%.
 */
export function isSpreadTooWide(snapshot: MarketSnapshot): {
  tooWide: boolean;
  shouldDowngrade: boolean;
  level: "normal" | "wide" | "downgrade";
} {
  if (snapshot.spreadRate > 0.003) {
    return { tooWide: true, shouldDowngrade: true, level: "downgrade" };
  }
  if (snapshot.spreadRate > 0.001) {
    return { tooWide: true, shouldDowngrade: false, level: "wide" };
  }
  return { tooWide: false, shouldDowngrade: false, level: "normal" };
}

/**
 * Validate a market snapshot has all required fields for trading.
 * Missing markPrice on a perp snapshot is a hard block.
 */
export function validateSnapshot(snapshot: MarketSnapshot): {
  valid: boolean;
  missingFields: string[];
} {
  const missing: string[] = [];

  if (!snapshot.bid1 || snapshot.bid1 <= 0) missing.push("bid1");
  if (!snapshot.ask1 || snapshot.ask1 <= 0) missing.push("ask1");
  if (!snapshot.timestampUtc || snapshot.timestampUtc <= 0) missing.push("timestampUtc");

  if (snapshot.marketType === "perp") {
    if (snapshot.markPrice === undefined || snapshot.markPrice <= 0) {
      missing.push("markPrice");
    }
  }

  return { valid: missing.length === 0, missingFields: missing };
}
