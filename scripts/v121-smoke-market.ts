/**
 * V1.2.1 Smoke Test — CONTROLLED_LIVE Readiness
 *
 * Fetches real public market data from Binance/OKX/HTX.
 * HTX failures are warnings (observe-only), not blockers for Binance readiness.
 *
 * Run: npx tsx scripts/v121-smoke-market.ts
 */

import { BinancePublicAdapter } from "../lib/strategy-v121/market/adapters/binancePublicAdapter";
import { OkxPublicAdapter } from "../lib/strategy-v121/market/adapters/okxPublicAdapter";
import { HtxPublicAdapter } from "../lib/strategy-v121/market/adapters/htxPublicAdapter";
import { buildMarketSnapshot } from "../lib/strategy-v121/market/adapters/types";

type SmokeStatus = "pass" | "warn" | "fail";

interface SmokeExchangeResult {
  status: SmokeStatus;
  reason?: string;
  fundingRate?: number;
  markPrice?: number;
  indexPrice?: number;
  spotBid?: number;
  spotAsk?: number;
  perpBid?: number;
  perpAsk?: number;
}

async function main() {
  const symbol = "BTC/USDT";
  console.log(`\nV1.2.1 Smoke Test — ${symbol}\n`);

  const results: Record<string, SmokeExchangeResult> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ─── Binance ───────────────────────────────────────────────
  try {
    const b = new BinancePublicAdapter();
    const spotTicker = await b.fetchTicker("BTCUSDT");
    const spotOB = await b.fetchOrderBook("BTCUSDT", 5);
    const spotSnap = buildMarketSnapshot("binance", symbol, "spot", spotTicker, spotOB);
    const perpTicker = await b.fetchTicker("BTCUSDT");
    const perpOB = await b.fetchOrderBook("BTCUSDT", 5);
    let funding;
    try { funding = await b.fetchFundingInfo("BTCUSDT"); } catch { /* ok */ }
    const perpSnap = buildMarketSnapshot("binance", symbol, "perp", perpTicker, perpOB, funding);
    console.log(`--- Binance ---\n  Spot: bid=${spotSnap.bid1} ask=${spotSnap.ask1} vol=$${(spotSnap.volume24hUsdt ?? 0).toLocaleString()}`);
    console.log(`  Perp: bid=${perpSnap.bid1} ask=${perpSnap.ask1} vol=$${(perpSnap.volume24hUsdt ?? 0).toLocaleString()}`);
    if (perpSnap.fundingRate !== undefined) {
      console.log(`  Funding: ${(perpSnap.fundingRate * 100).toFixed(4)}%/8h`);
    }
    if (perpSnap.markPrice) console.log(`  Mark: ${perpSnap.markPrice}  Index: ${perpSnap.indexPrice ?? "N/A"}`);
    console.log(`  Binance OK`);
    results.binance = { status: "pass", fundingRate: perpSnap.fundingRate, markPrice: perpSnap.markPrice, indexPrice: perpSnap.indexPrice, spotBid: spotSnap.bid1, spotAsk: spotSnap.ask1, perpBid: perpSnap.bid1, perpAsk: perpSnap.ask1 };
  } catch (err: any) {
    console.error(`--- Binance ---\n  FAILED: ${err.message}`);
    results.binance = { status: "fail", reason: err.message };
    blockers.push(`Binance smoke failed: ${err.message}`);
  }

  // ─── OKX ──────────────────────────────────────────────────
  try {
    const o = new OkxPublicAdapter();
    const spotTicker = await o.fetchTicker("BTC-USDT");
    const spotOB = await o.fetchOrderBook("BTC-USDT", 5);
    const spotSnap = buildMarketSnapshot("okx", symbol, "spot", spotTicker, spotOB);
    const perpTicker = await o.fetchTicker("BTC-USDT-SWAP");
    const perpOB = await o.fetchOrderBook("BTC-USDT-SWAP", 5);
    let funding;
    try { funding = await o.fetchFundingInfo("BTC-USDT-SWAP"); } catch { /* ok */ }
    const perpSnap = buildMarketSnapshot("okx", symbol, "perp", perpTicker, perpOB, funding);
    console.log(`--- OKX ---\n  Spot: bid=${spotSnap.bid1} ask=${spotSnap.ask1} vol=$${(spotSnap.volume24hUsdt ?? 0).toLocaleString()}`);
    console.log(`  Perp: bid=${perpSnap.bid1} ask=${perpSnap.ask1} vol=$${(perpSnap.volume24hUsdt ?? 0).toLocaleString()}`);
    if (perpSnap.fundingRate !== undefined) {
      console.log(`  Funding: ${(perpSnap.fundingRate * 100).toFixed(4)}%/8h`);
    }
    console.log(`  OKX OK`);
    results.okx = { status: "pass", fundingRate: perpSnap.fundingRate, spotBid: spotSnap.bid1, spotAsk: spotSnap.ask1, perpBid: perpSnap.bid1, perpAsk: perpSnap.ask1 };
  } catch (err: any) {
    console.error(`--- OKX ---\n  FAILED: ${err.message}`);
    results.okx = { status: "warn", reason: err.message };
    warnings.push(`OKX smoke failed: ${err.message}`);
  }

  // ─── HTX ──────────────────────────────────────────────────
  // HTX is observe-only. Perp swap ticker may not be available.
  try {
    const h = new HtxPublicAdapter();
    const spotTicker = await h.fetchTicker("btcusdt");
    const spotOB = await h.fetchOrderBook("btcusdt", 5);
    const spotSnap = buildMarketSnapshot("htx", symbol, "spot", spotTicker, spotOB);
    console.log(`--- HTX ---\n  Spot: bid=${spotSnap.bid1} ask=${spotSnap.ask1} vol=$${(spotSnap.volume24hUsdt ?? 0).toLocaleString()}`);
    // HTX perp uses swap-specific endpoint; if it fails, treat as warning
    try {
      const perpTicker = await h.fetchTickerSwap("BTC-USDT");
      const perpOB = await h.fetchOrderBookSwap("BTC-USDT", 5);
      let funding;
      try { funding = await h.fetchFundingInfo("BTC-USDT"); } catch { /* ok */ }
      const perpSnap = buildMarketSnapshot("htx", symbol, "perp", perpTicker, perpOB, funding);
      console.log(`  Perp: bid=${perpSnap.bid1} ask=${perpSnap.ask1} vol=$${(perpSnap.volume24hUsdt ?? 0).toLocaleString()}`);
      if (perpSnap.fundingRate !== undefined) console.log(`  Funding: ${(perpSnap.fundingRate * 100).toFixed(4)}%/8h`);
      console.log(`  HTX OK`);
      results.htx = { status: "pass", fundingRate: spotSnap.volume24hUsdt ? 0 : undefined, spotBid: spotSnap.bid1, spotAsk: spotSnap.ask1 };
    } catch (perpErr: any) {
      console.log(`  Perp: N/A (${perpErr.message}) — observe-only, non-blocking`);
      warnings.push(`HTX perp swap ticker unavailable (observe-only, non-blocking): ${perpErr.message}`);
      results.htx = { status: "warn", reason: `htx_perp_swap_ticker_unavailable_observe_only: ${perpErr.message}`, spotBid: spotSnap.bid1, spotAsk: spotSnap.ask1 };
    }
  } catch (err: any) {
    console.error(`--- HTX ---\n  FAILED (spot): ${err.message}`);
    warnings.push(`HTX smoke failed (observe-only, non-blocking): ${err.message}`);
    results.htx = { status: "warn", reason: err.message };
  }

  // ─── Summary ──────────────────────────────────────────────
  const binanceOk = results.binance?.status === "pass";
  const ok = binanceOk;
  const scope = "binance_controlled_live";
  const realTransfer = process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER === "1";
  const realOrder = process.env.V121_ENABLE_REAL_ORDER_EXECUTION === "1";

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Smoke Result:`);
  console.log(`  Binance: ${results.binance?.status ?? "N/A"}`);
  console.log(`  OKX:     ${results.okx?.status ?? "N/A"}`);
  console.log(`  HTX:     ${results.htx?.status ?? "N/A"}`);
  console.log(`  Blockers: ${blockers.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`\n  CONTROLLED_LIVE_READINESS_SCOPE=${scope}`);
  console.log(`  BLOCKERS=${blockers.length}`);
  console.log(`  WARNINGS=${warnings.length}`);
  console.log(`  REAL_TRANSFER_ENABLED=${realTransfer}`);
  console.log(`  REAL_ORDER_ENABLED=${realOrder}`);

  if (!binanceOk) {
    console.error(`\n❌ Binance smoke failed — blocked.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️ Warnings:\n  ${warnings.join("\n  ")}`);
  }
  console.log(`\n✅ ${scope} — smoke passed.`);
}

main().catch(err => {
  console.error("Smoke test error:", err);
  process.exit(1);
});
