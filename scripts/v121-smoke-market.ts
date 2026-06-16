/**
 * V1.2.1 Market Smoke Test
 *
 * Fetches real public market data from Binance/OKX/HTX
 * and prints MarketSnapshots for verification.
 *
 * Run: npx tsx scripts/v121-smoke-market.ts
 */

import { BinancePublicAdapter } from "../lib/strategy-v121/market/adapters/binancePublicAdapter";
import { OkxPublicAdapter } from "../lib/strategy-v121/market/adapters/okxPublicAdapter";
import { HtxPublicAdapter } from "../lib/strategy-v121/market/adapters/htxPublicAdapter";
import { buildMarketSnapshot } from "../lib/strategy-v121/market/adapters/types";

async function main() {
  const symbol = "BTC/USDT";
  console.log(`\nV1.2.1 Market Smoke Test — ${symbol}\n`);

  const tests = [
    { name: "Binance", adapter: new BinancePublicAdapter(), spotSym: "BTCUSDT", perpSym: "BTCUSDT" },
    { name: "OKX",     adapter: new OkxPublicAdapter(),     spotSym: "BTC-USDT", perpSym: "BTC-USDT-SWAP" },
    { name: "HTX",     adapter: new HtxPublicAdapter(),     spotSym: "btcusdt",  perpSym: "BTC-USDT" },
  ];

  let ok = 0;
  let fail = 0;

  for (const ex of tests) {
    try {
      console.log(`\n--- ${ex.name} ---`);

      const spotTicker = await ex.adapter.fetchTicker(ex.spotSym);
      const spotOB = await ex.adapter.fetchOrderBook(ex.spotSym, 5);
      const spotSnap = buildMarketSnapshot(ex.adapter.exchangeId, symbol, "spot", spotTicker, spotOB);
      console.log(`  Spot: bid=${spotSnap.bid1} ask=${spotSnap.ask1} spread=${(spotSnap.spreadRate * 100).toFixed(3)}% vol=$${(spotSnap.volume24hUsdt ?? 0).toLocaleString()}`);

      const perpTicker = await ex.adapter.fetchTicker(ex.perpSym);
      const perpOB = await ex.adapter.fetchOrderBook(ex.perpSym, 5);
      let funding;
      try { funding = await ex.adapter.fetchFundingInfo(ex.perpSym); } catch { /* ok */ }
      const perpSnap = buildMarketSnapshot(ex.adapter.exchangeId, symbol, "perp", perpTicker, perpOB, funding);
      console.log(`  Perp: bid=${perpSnap.bid1} ask=${perpSnap.ask1} spread=${(perpSnap.spreadRate * 100).toFixed(3)}% vol=$${(perpSnap.volume24hUsdt ?? 0).toLocaleString()}`);
      if (perpSnap.fundingRate !== undefined) {
        console.log(`  Funding: ${(perpSnap.fundingRate * 100).toFixed(4)}%/8h next=${perpSnap.nextFundingTimeUtc ? new Date(perpSnap.nextFundingTimeUtc).toISOString() : "N/A"}`);
      }
      if (perpSnap.markPrice) console.log(`  Mark: ${perpSnap.markPrice}  Index: ${perpSnap.indexPrice ?? "N/A"}`);

      ok++;
      console.log(`  ${ex.name} OK`);
    } catch (err) {
      fail++;
      console.error(`  ${ex.name} FAILED:`, (err as Error).message);
    }
  }

  console.log(`\nDone. ${ok} passed, ${fail} failed.`);
}

main().catch(console.error);
