import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { runCapitalPrecheck } from "@/lib/strategy-v121/execution/capitalPrecheck";

export async function GET(request: Request) {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const { searchParams } = new URL(request.url);
  const exchange = (searchParams.get("exchange") ?? "binance") as any;
  const symbol = searchParams.get("symbol") ?? "BTC/USDT";
  const notional = Number(searchParams.get("notional") ?? "10");

  try {
    const result = await runCapitalPrecheck(exchange, symbol, notional);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
