import { NextResponse } from "next/server";
import { discoverSameExchangeUniverse } from "@/lib/strategy-v121/market/universeDiscovery";

export async function GET() {
  try {
    const items = await discoverSameExchangeUniverse();
    return NextResponse.json({
      items,
      total: items.length,
      binanceCount: items.filter(i => i.exchange === "binance").length,
      okxCount: items.filter(i => i.exchange === "okx").length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
