/**
 * Binance 主网只读账户适配器
 *
 * 读取现货余额、合约仓位、当前挂单。
 * 不下单、不撤单、不改杠杆、不划转。
 */

import type { ExchangeId } from "../../domain/types";
import type {
  IAccountAdapter, AccountBalanceSnapshot,
  AccountPositionSnapshot, OpenOrderSnapshot,
} from "../accountTypes";
import { binanceSign, utcTimestampMs } from "./accountSigning";

const SPOT = "https://api.binance.com";
const FUTURES = "https://fapi.binance.com";

export class BinanceAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "binance";

  private async signedGet(base: string, path: string): Promise<any> {
    const query = `timestamp=${utcTimestampMs()}`;
    const { signature, apiKey } = binanceSign(query);
    const url = `${base}${path}?${query}&signature=${signature}`;
    const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet(SPOT, "/api/v3/account");
    const now = new Date().toISOString();
    return (data.balances ?? [])
      .filter((b: any) => Number(b.free) > 0 || Number(b.locked) > 0)
      .map((b: any) => ({
        exchange: "binance" as ExchangeId,
        asset: b.asset,
        free: Number(b.free),
        locked: Number(b.locked),
        total: Number(b.free) + Number(b.locked),
        fetchedAtUtc: now,
      }));
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    const data = await this.signedGet(FUTURES, "/fapi/v2/positionRisk");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(p.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: Number(p.positionAmt) < 0 ? "perp_short" as const : "spot_long" as const,
        quantity: Math.abs(Number(p.positionAmt)),
        notionalUsdt: Math.abs(Number(p.notional ?? 0)),
        entryPrice: Number(p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedPnlUsdt: Number(p.unRealizedProfit ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet(FUTURES, "/fapi/v1/openOrders");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((o: any) => o.status === "NEW" || o.status === "PARTIALLY_FILLED")
      .map((o: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(o.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: o.side === "BUY" ? "buy" as const : "sell" as const,
        price: Number(o.price ?? 0),
        quantity: Number(o.origQty ?? 0),
        filledQuantity: Number(o.executedQty ?? 0),
        status: o.status === "NEW" ? "open" as const : "partially_filled" as const,
        createdAtUtc: o.time ? new Date(Number(o.time)).toISOString() : undefined,
        fetchedAtUtc: now,
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${FUTURES}/fapi/v1/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
