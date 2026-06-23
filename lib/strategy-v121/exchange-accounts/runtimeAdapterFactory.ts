/**
 * Runtime Adapter Factory — 根据用户保存的 API Key 构造运行时只读 adapter。
 *
 * 与 accountAdapterFactory 的区别：
 *  - accountAdapterFactory 从 process.env 读取密钥（运维预配置）。
 *  - runtimeAdapterFactory 接受运行时注入的明文密钥（从数据库解密得到），
 *    用于 probeAccount 等按账户探测的场景。
 *
 * 安全：
 *  - 仅构造只读 adapter（fetchBalances / fetchPositions / fetchOpenOrders / healthCheck）。
 *  - 不构造下单 / 撤单 / 划转方法。
 *  - 明文密钥仅在服务端内存中短暂持有，不写入日志，不返回给调用方。
 *  - 不检测提现权限作为唯一安全依据。
 */

import * as crypto from "node:crypto";
import type { ExchangeId } from "../domain/types";
import type {
  IAccountAdapter,
  AccountBalanceSnapshot,
  AccountPositionSnapshot,
  OpenOrderSnapshot,
} from "../account/accountTypes";
import { safeFetch } from "../account/adapters/safeFetch";

// ─── 运行时密钥输入 ─────────────────────────────────

export interface RuntimeApiKeyInput {
  exchange: ExchangeId;
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // OKX only
}

// ─── 工厂结果 ───────────────────────────────────────

export type RuntimeAdapterStatus = "ok" | "not_supported" | "observe_only";

export interface RuntimeAdapterFactoryResult {
  adapter: IAccountAdapter;
  status: RuntimeAdapterStatus;
  /** status !== "ok" 时的说明。 */
  message?: string;
}

// ─── Binance 运行时只读 adapter ─────────────────────

const BINANCE_SPOT = "https://api.binance.com";
const BINANCE_FUTURES = "https://fapi.binance.com";

/**
 * Binance 运行时只读 adapter — 使用注入的 apiKey/secret 签名。
 *
 * 仅实现读取方法，不实现下单/划转。
 * 签名逻辑与 accountSigning.binanceSign 一致，但密钥来自构造参数而非 process.env。
 */
class BinanceRuntimeReadAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "binance";

  constructor(apiKey: string, apiSecret: string) {
    // 密钥以非枚举属性存储，避免 JSON.stringify / 日志意外泄露。
    Object.defineProperty(this, "_apiKey", {
      value: apiKey,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, "_apiSecret", {
      value: apiSecret,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  private get apiKey(): string {
    return (this as any)._apiKey;
  }

  private get apiSecret(): string {
    return (this as any)._apiSecret;
  }

  private sign(queryString: string): { signature: string; apiKey: string } {
    const signature = crypto
      .createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
    return { signature, apiKey: this.apiKey };
  }

  private async signedGet(
    base: string,
    path: string,
    extraParams?: Record<string, string>,
  ): Promise<any> {
    const ts = Date.now();
    let query = `timestamp=${ts}&recvWindow=5000`;
    if (extraParams) {
      const extra = new URLSearchParams(extraParams).toString();
      query = `${extra}&${query}`;
    }
    const { signature, apiKey } = this.sign(query);
    const url = `${base}${path}?${query}&signature=${signature}`;
    const result = await safeFetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    if (!result.ok) throw new Error(result.errorMessage ?? "Binance 请求失败");
    return result.body;
  }

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    const data = await this.signedGet(BINANCE_SPOT, "/api/v3/account");
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
    const data = await this.signedGet(BINANCE_FUTURES, "/fapi/v2/positionRisk");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((p: any) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(p.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: Number(p.positionAmt) < 0 ? ("perp_short" as const) : ("spot_long" as const),
        quantity: Math.abs(Number(p.positionAmt)),
        notionalUsdt: Math.abs(Number(p.notional ?? 0)),
        entryPrice: Number(p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedPnlUsdt: Number(p.unRealizedProfit ?? 0),
        fetchedAtUtc: now,
      }));
  }

  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    const data = await this.signedGet(BINANCE_FUTURES, "/fapi/v1/openOrders");
    const now = new Date().toISOString();
    return (data ?? [])
      .filter((o: any) => o.status === "NEW" || o.status === "PARTIALLY_FILLED")
      .map((o: any) => ({
        exchange: "binance" as ExchangeId,
        symbol: String(o.symbol).replace("USDT", "/USDT"),
        marketType: "perp" as const,
        side: o.side === "BUY" ? ("buy" as const) : ("sell" as const),
        price: Number(o.price ?? 0),
        quantity: Number(o.origQty ?? 0),
        filledQuantity: Number(o.executedQty ?? 0),
        status: o.status === "NEW" ? ("open" as const) : ("partially_filled" as const),
        createdAtUtc: o.time ? new Date(Number(o.time)).toISOString() : undefined,
        fetchedAtUtc: now,
      }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BINANCE_FUTURES}/fapi/v1/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ─── HTX observe-only adapter（不执行套利）──────────

class HtxObserveOnlyAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "htx";

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    throw new Error("HTX 在 V1.2.1 中为 observe-only，不支持运行时账户探测");
  }
  async healthCheck(): Promise<boolean> {
    // HTX 公共行情健康检查仍可执行
    try {
      const res = await fetch("https://api.huobi.pro/v2/market-status");
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ─── OKX not_supported adapter ──────────────────────

class OkxNotSupportedAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "okx";

  async fetchBalances(): Promise<AccountBalanceSnapshot[]> {
    throw new Error("OKX 运行时密钥注入暂不支持，不允许探测执行权限");
  }
  async fetchPositions(): Promise<AccountPositionSnapshot[]> {
    throw new Error("OKX 运行时密钥注入暂不支持，不允许探测执行权限");
  }
  async fetchOpenOrders(): Promise<OpenOrderSnapshot[]> {
    throw new Error("OKX 运行时密钥注入暂不支持，不允许探测执行权限");
  }
  async healthCheck(): Promise<boolean> {
    // OKX 公共行情健康检查仍可执行
    try {
      const res = await fetch("https://www.okx.com/api/v5/public/time");
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ─── 工厂入口 ───────────────────────────────────────

/**
 * 根据运行时密钥构造只读 adapter。
 *
 * @param input - 运行时密钥输入（从数据库解密得到）。
 * @returns { adapter, status, message }
 *  - status="ok": Binance，可进行只读探测。
 *  - status="not_supported": OKX，运行时注入暂不支持，不允许误判为可执行。
 *  - status="observe_only": HTX，仅观察，不执行套利探测。
 */
export function createRuntimeAdapter(input: RuntimeApiKeyInput): RuntimeAdapterFactoryResult {
  switch (input.exchange) {
    case "binance":
      if (!input.apiKey || !input.apiSecret) {
        return {
          adapter: new OkxNotSupportedAdapter(), // placeholder, status 说明问题
          status: "not_supported",
          message: "Binance 运行时密钥不完整（apiKey 或 apiSecret 为空）",
        };
      }
      return {
        adapter: new BinanceRuntimeReadAdapter(input.apiKey, input.apiSecret),
        status: "ok",
      };

    case "okx":
      // OKX 运行时密钥注入暂不支持 — 不允许误判为可执行。
      // 探测会抛错，capabilityDetector 会记录 lastError。
      return {
        adapter: new OkxNotSupportedAdapter(),
        status: "not_supported",
        message: "OKX 运行时密钥注入暂不支持，权限检测将标记为不可用",
      };

    case "htx":
      // HTX observe-only — 不执行套利探测。
      return {
        adapter: new HtxObserveOnlyAdapter(),
        status: "observe_only",
        message: "HTX 在 V1.2.1 中为 observe-only，不可用于套利执行",
      };

    default:
      return {
        adapter: new OkxNotSupportedAdapter(),
        status: "not_supported",
        message: `不支持的交易所: ${input.exchange}`,
      };
  }
}
