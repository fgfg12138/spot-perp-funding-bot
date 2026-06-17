/**
 * Symbol mapping between canonical (unified) symbols and exchange-specific symbols.
 *
 * Canonical format: "BTC/USDT", "ETH/USDT", "1000PEPE/USDT"
 */

export type CanonicalSymbol = string; // e.g. "BTC/USDT"

/**
 * Convert canonical symbol to exchange-specific format.
 *
 * Examples:
 * - Binance spot: "BTC/USDT" → "BTCUSDT"
 * - Binance perp: "BTC/USDT" → "BTCUSDT"
 * - OKX spot:   "BTC/USDT" → "BTC-USDT"
 * - OKX perp:   "BTC/USDT" → "BTC-USDT-SWAP"
 * - HTX spot:   "BTC/USDT" → "btcusdt"
 * - HTX perp:   "BTC/USDT" → "BTC-USDT"
 */
export function canonicalToExchange(
  canonical: CanonicalSymbol,
  exchange: string,
  marketType: "spot" | "perp"
): string {
  const [base, quote] = canonical.split("/");
  if (!base || !quote) return canonical;

  switch (exchange) {
    case "binance":
      return `${base}${quote}`;
    case "okx":
      return marketType === "perp" ? `${base}-${quote}-SWAP` : `${base}-${quote}`;
    case "htx":
      return marketType === "spot" ? `${base}${quote}`.toLowerCase() : `${base}-${quote}`;
    default:
      return canonical;
  }
}

/**
 * Convert exchange-specific symbol back to canonical.
 */
export function exchangeToCanonical(
  exchangeSymbol: string,
  exchange: string,
  marketType: "spot" | "perp"
): CanonicalSymbol {
  const s = exchangeSymbol.toUpperCase();

  switch (exchange) {
    case "binance":
      // BTCUSDT → BTC/USDT
      return s.replace(/USDT$/, "/USDT");
    case "okx":
      // BTC-USDT-SWAP → BTC/USDT, BTC-USDT → BTC/USDT
      return s.replace(/-SWAP$/, "").replace(/-/g, "/");
    case "htx":
      // BTC-USDT → BTC/USDT, btcusdt → BTC/USDT
      return s.replace(/-/g, "/");
    default:
      return s;
  }
}

/**
 * Known trading pairs that exist on all three exchanges.
 */
export const V121_UNIVERSE: CanonicalSymbol[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "DOGE/USDT",
  "XRP/USDT",
  "ADA/USDT",
  "AVAX/USDT",
  "DOT/USDT",
  "LINK/USDT",
  "MATIC/USDT",
  "1000PEPE/USDT",
  "1000BONK/USDT",
  "SUI/USDT",
  "ARB/USDT",
  "OP/USDT",
];

/** 保守 universe — 只包含主流高流动性币，适合初始扫描和 CI 测试 */
export const CONSERVATIVE_UNIVERSE: CanonicalSymbol[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "DOGE/USDT",
  "XRP/USDT",
];
