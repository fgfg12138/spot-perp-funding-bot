/**
 * OKX 主网只读账户适配器
 *
 * 读取余额、仓位、当前挂单。
 * 不下单、不撤单、不改杠杆、不划转。
 */

import type { ExchangeId } from "../../domain/types";
import type {
  IAccountAdapter, AccountBalanceSnapshot,
  AccountPositionSnapshot, OpenOrderSnapshot,
} from "../accountTypes";
import { okxSign } from "./accountSigning";

const BASE = "https://www.okx.com";

export class OkxAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "okx";

  private async signedGet(path: string): Promise<any> {
    const ts = new Date().toISOString();
    const { apiKey, passphrase, sign } = okxSign(ts, "GET", path, "");
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
      },
    });
    const body = await res.json();
    if (body.code !== "0") throw new Error(`OKX API ${body.code}: ${body.msg ?? "未知错误"}`);
    return body.data;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet("/api/v5/account/balance");
    const now = new Date().toISOString();
    if (!data?.[0]?.details) return [];
    return data[0].details.map((d: any) => ({
      exchange: "okx" as ExchangeId,
      asset: d.ccy ?? d.currency ?? "?",
      free: Number(d.cashBal ?? d.availBal ?? 0),
      locked: Number(d.frozenBal ?? 0),
      total: Number(d.eq ?? (Number(d.cashBal ?? 0) + Number(d.frozenBal ?? 0))),
      usdtValue: d.ccy === "USDT" ? Number(d.eq ?? 0) : undefined,
      fetchedAtUtc: now,
    }));
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    const data = await this.signedGet("/api/v5/account/positions");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.pos ?? 0)) > 0)
      .map((p: any) => ({
        exchange: "okx" as ExchangeId,
        symbol: String(p.instId ?? "").replace("-USDT-SWAP", "/USDT"),
        marketType: "perp" as const,
        side: p.posSide === "short" ? "perp_short" as const : "spot_long" as const,
        quantity: Math.abs(Number(p.pos ?? 0)),
        notionalUsdt: Math.abs(Number(p.notionalUsd ?? p.notional ?? 0)),
        entryPrice: Number(p.avgPx ?? 0),
        markPrice: Number(p.markPx ?? 0),
        unrealizedPnlUsdt: Number(p.upl ?? 0),
        marginRatio: Number(p.mgnRatio ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet("/api/v5/trade/orders-pending");
    const now = new Date().toISOString();
    return (data ?? []).map((o: any) => ({
      exchange: "okx" as ExchangeId,
      symbol: String(o.instId ?? "").replace("-USDT-SWAP", "/USDT"),
      marketType: "perp" as const,
      side: o.side === "buy" ? "buy" as const : "sell" as const,
      price: Number(o.px ?? 0),
      quantity: Number(o.sz ?? 0),
      filledQuantity: Number(o.accFillSz ?? 0),
      status: o.state === "live" ? "open" as const : "partially_filled" as const,
      createdAtUtc: o.cTime ? new Date(Number(o.cTime)).toISOString() : undefined,
      fetchedAtUtc: now,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/api/v5/public/time`);
      const body = await res.json();
      return body.code === "0";
    } catch {
      return false;
    }
  }
}
