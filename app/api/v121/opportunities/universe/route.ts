import { NextResponse } from "next/server";
import {
  discoverSameExchangeUniverse,
  getUniverseDiscoveryMeta,
} from "@/lib/strategy-v121/market/universeDiscovery";

export async function GET() {
  try {
    const items = await discoverSameExchangeUniverse();
    const meta = getUniverseDiscoveryMeta();
    return NextResponse.json({
      items,
      total: items.length,
      eligibleForScan: items.filter(i => i.eligibleForScan).length,
      eligibleForTiny: items.filter(i => i.eligibleForTiny).length,
      binanceCount: items.filter(i => i.exchange === "binance").length,
      okxCount: items.filter(i => i.exchange === "okx").length,
      warnings: meta.warnings,
      usedCache: meta.usedCache,
      lastSuccessfulAtUtc: meta.lastSuccessfulAtUtc,
    });
  } catch (err: any) {
    const meta = getUniverseDiscoveryMeta();
    return NextResponse.json({
      error: err.message,
      warnings: meta.warnings,
      usedCache: meta.usedCache,
      lastSuccessfulAtUtc: meta.lastSuccessfulAtUtc,
    }, { status: 500 });
  }
}
