/**
 * HTX 主网只读账户适配器
 *
 * 读取现货余额、合约仓位。
 * HTX 开放式订单接口复杂度较高，暂不实现。
 * 不下单、不撤单、不改杠杆、不划转。
 */

import type { ExchangeId } from "../../domain/types";
import type {
  IAccountAdapter, AccountBalanceSnapshot,
  AccountPositionSnapshot, OpenOrderSnapshot,
} from "../accountTypes";
import { htxSign, utcTimestampMs } from "./accountSigning";

const SPOT_BASE = "https://api.huobi.pro";
const SWAP_BASE = "https://api.hbdm.com";

export class HtxAccountAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "htx";

  private async signedGet(base: string, path: string, extraParams: Record<string, string> = {}): Promise<any> {
    const ts = utcTimestampMs().toString();
    const params = { ...extraParams, Timestamp: ts };
    const host = new URL(base).host;
    const signed = htxSign("GET", host, path, params);
    const qs = Object.entries(signed)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${base}${path}?${qs}`;
    const res = await fetch(url);
    const body = await res.json();
    if (body.status !== "ok") throw new Error(`HTX API: ${body["err-msg"] ?? JSON.stringify(body)}`);
    return body;
  }

  private async getAccountId(): Promise<string | null> {
    const data = await this.signedGet(SPOT_BASE, "/v1/account/accounts");
    const accounts = data.data ?? [];
    const spot = accounts.find((a: any) => a.type === "spot" && a.state === "working");
    return spot?.id?.toString() ?? null;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const now = new Date().toISOString();
    try {
      const acctId = await this.getAccountId();
      if (!acctId) return [];
      const data = await this.signedGet(SPOT_BASE, `/v1/account/accounts/${acctId}/balance`);
      const list = data.data?.list ?? [];
      const merged = new Map<string, { free: number; locked: number; asset: string }>();
      for (const b of list) {
        const prev = merged.get(b.currency) ?? { free: 0, locked: 0, asset: b.currency };
        if (b.type === "trade") prev.free += Number(b.balance ?? 0);
        else prev.locked += Number(b.balance ?? 0);
        merged.set(b.currency, prev);
      }
      return [...merged.values()].map(b => ({
        exchange: "htx" as ExchangeId,
        asset: b.asset,
        free: b.free,
        locked: b.locked,
        total: b.free + b.locked,
        fetchedAtUtc: now,
      }));
    } catch (err) {
      throw new Error(`HTX 余额读取失败: ${(err as Error).message}`);
    }
  }

  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    const now = new Date().toISOString();
    try {
      const data = await this.signedGet(SWAP_BASE, "/linear-swap-api/v1/swap_account_info", {});
      const info = data.data ?? [];
      const positions: AccountPositionSnapshot[] = [];
      for (const item of info) {
        for (const p of item.swap_position ?? []) {
          const qty = Number(p.volume ?? 0);
          if (qty <= 0) continue;
          positions.push({
            exchange: "htx" as ExchangeId,
            symbol: `${item.symbol ?? item.contract_code}/USDT`,
            marketType: "perp" as const,
            side: p.direction === "sell" ? "perp_short" as const : "spot_long" as const,
            quantity: Math.abs(qty),
            notionalUsdt: Math.abs(Number(p.margin_asset ?? 0)),
            entryPrice: Number(p.cost_open ?? 0),
            markPrice: Number(p.mark_price ?? 0),
            unrealizedPnlUsdt: Number(p.unsettled_profit ?? 0),
            fetchedAtUtc: now,
          });
        }
      }
      return positions;
    } catch (err) {
      throw new Error(`HTX 仓位读取失败: ${(err as Error).message}`);
    }
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    // HTX 开放式订单接口需要额外处理，暂返回空数组
    // TODO: 实现 HTX 挂单读取
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${SPOT_BASE}/v2/status`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
