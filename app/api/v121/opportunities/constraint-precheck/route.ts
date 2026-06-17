import { NextResponse } from "next/server";
import { checkOrderConstraint } from "@/lib/strategy-v121/execution/orderConstraintPrecheck";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "BTC/USDT";
  const exchange = (searchParams.get("exchange") ?? "binance") as any;
  const notional = Number(searchParams.get("notional") ?? "10");

  try {
    const result = await checkOrderConstraint(exchange, symbol, notional);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
