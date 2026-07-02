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

// ─── V2 分池定义（按用户策略规则） ──────────────────

/**
 * 核心池：优先监控，低风险测试，主要交易池
 * 用途：长期监控、主要交易池
 * 资金分配：同所标准版（30/30/30/10）
 */
export const CORE_POOL: CanonicalSymbol[] = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
  "ADA/USDT", "LINK/USDT", "AVAX/USDT", "DOT/USDT", "LTC/USDT",
  "BCH/USDT", "TRX/USDT",
];

/**
 * 机会池：收益够高才做
 * 用途：资金费机会更多，但波动更大，仓位要比核心池小
 * 资金分配：山寨版（20/20/50/10）
 */
export const OPPORTUNITY_POOL: CanonicalSymbol[] = [
  "NEAR/USDT", "APT/USDT", "SUI/USDT", "ARB/USDT", "OP/USDT",
  "FIL/USDT", "ETC/USDT", "ATOM/USDT", "UNI/USDT", "AAVE/USDT",
  "INJ/USDT", "DYDX/USDT",
];

/**
 * 高风险观察池：只报警，小仓测试，不自动重仓
 */
export const WATCH_POOL: CanonicalSymbol[] = [
  "PEPE/USDT", "SHIB/USDT", "FLOKI/USDT", "BONK/USDT",
  "WIF/USDT", "ORDI/USDT", "1000SATS/USDT",
];

/**
 * 黑名单池：默认不做
 * 平台币、稳定币交易对、极小市值 Meme
 * 注：BNB/OKB 先不做主力
 */
export const BLACKLIST_POOL: CanonicalSymbol[] = [
  "BNB/USDT", "OKB/USDT", "USDC/USDT", "FDUSD/USDT",
  "TUSD/USDT", "DAI/USDT", "USDP/USDT",
];

/**
 * 全部可交易币种的合并列表（按优先级排序：核心 > 机会 > 观察）
 * 用于向后兼容 OPPORTUNITY_WATCHLIST
 */
export const ALL_CANDIDATE_SYMBOLS: CanonicalSymbol[] = [
  ...CORE_POOL,
  ...OPPORTUNITY_POOL,
  ...WATCH_POOL,
];

/**
 * 机会展示白名单 — 兼容旧版引用，指向 ALL_CANDIDATE_SYMBOLS
 */
export const OPPORTUNITY_WATCHLIST: CanonicalSymbol[] = ALL_CANDIDATE_SYMBOLS;

/**
 * 根据池名称获取对应列表
 */
export function getPoolByName(pool: "core" | "opportunity" | "watch" | "blacklist"): CanonicalSymbol[] {
  switch (pool) {
    case "core": return CORE_POOL;
    case "opportunity": return OPPORTUNITY_POOL;
    case "watch": return WATCH_POOL;
    case "blacklist": return BLACKLIST_POOL;
  }
}

/**
 * 判断一个币属于哪个池
 */
export function classifySymbol(symbol: CanonicalSymbol): "core" | "opportunity" | "watch" | "blacklist" | "none" {
  if (CORE_POOL.includes(symbol)) return "core";
  if (OPPORTUNITY_POOL.includes(symbol)) return "opportunity";
  if (WATCH_POOL.includes(symbol)) return "watch";
  if (BLACKLIST_POOL.includes(symbol)) return "blacklist";
  return "none";
}
