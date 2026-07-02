import { describe, expect, it } from "vitest";
import {
  filterOpportunityByCapability,
  filterOpportunitiesByCapability,
  aggregateCapability,
  type AccountCapabilitySummary,
  type OpportunityPath,
} from "./opportunityCapabilityFilter";
import type { ExchangeCapability } from "../exchange-accounts/types";

// ─── Fixtures ──────────────────────────────────────

function makeFullCapability(
  exchange: string,
  overrides: Partial<ExchangeCapability> = {},
): ExchangeCapability {
  return {
    accountId: `acc_${exchange}`,
    exchange: exchange as any,
    readBalance: true,
    readSpot: true,
    readPerp: true,
    tradeSpot: true,
    tradePerp: true,
    internalTransfer: false,
    fundingRate: true,
    positions: true,
    orders: true,
    sameExchangeArbEnabled: true,
    crossExchangeArbEnabled: false,
    ...overrides,
  };
}

function makeAccount(
  exchange: string,
  opts: {
    enabled?: boolean;
    capability?: ExchangeCapability | false;
    crossExchange?: boolean;
  } = {},
): AccountCapabilitySummary {
  const cap =
    opts.capability === false
      ? undefined
      : makeFullCapability(exchange, {
          crossExchangeArbEnabled: opts.crossExchange ?? false,
          ...(opts.capability ?? {}),
        });
  return {
    id: `acc_${exchange}_001`,
    exchange: exchange as any,
    enabled: opts.enabled ?? true,
    capability: cap,
  };
}

const BINANCE_PATH: OpportunityPath = {
  symbol: "BTC/USDT",
  spotExchange: "binance",
  perpExchange: "binance",
};

const CROSS_PATH: OpportunityPath = {
  symbol: "BTC/USDT",
  spotExchange: "binance",
  perpExchange: "okx",
};

const HTX_PATH: OpportunityPath = {
  symbol: "BTC/USDT",
  spotExchange: "htx",
  perpExchange: "htx",
};

// ─── 本所套利测试 ──────────────────────────────────

describe("opportunityCapabilityFilter — 本所套利", () => {
  it("Binance account 全权限时 executable", () => {
    const accounts = [makeAccount("binance")];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.isCrossExchange).toBe(false);
    expect(result.executability).toBe("executable");
    expect(result.blockers).toHaveLength(0);
    expect(result.spotAccountId).toBe("acc_binance_001");
  });

  it("无 Binance account 时 blocked", () => {
    const accounts: AccountCapabilitySummary[] = [];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers[0]).toContain("未连接");
    expect(result.blockers[0]).toContain("BINANCE");
  });

  it("Binance account 已停用时 blocked", () => {
    const accounts = [makeAccount("binance", { enabled: false })];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers[0]).toContain("未连接");
  });

  it("只读 account（有 readBalance 无 trade）时 observable", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", {
          tradeSpot: false,
          tradePerp: false,
        }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("observable");
    expect(result.warnings.some((w) => w.includes("仅可观察"))).toBe(true);
  });

  it("缺少 tradeSpot 时 blocked（但有 tradePerp，不算只读）", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", { tradeSpot: false }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("现货交易"))).toBe(true);
  });

  it("缺少 tradePerp 时 blocked", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", { tradePerp: false }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("合约交易"))).toBe(true);
  });

  it("缺少 fundingRate 时 blocked", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", { fundingRate: false }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("资金费率"))).toBe(true);
  });

  it("缺少 positions 时 blocked", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", { positions: false }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("持仓查询"))).toBe(true);
  });

  it("缺少 readBalance 时 blocked", () => {
    const accounts = [
      makeAccount("binance", {
        capability: makeFullCapability("binance", { readBalance: false }),
      }),
    ];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("读取余额"))).toBe(true);
  });

  it("无 capability（未检测权限）时 blocked", () => {
    const accounts = [makeAccount("binance", { capability: false })];
    const result = filterOpportunityByCapability(BINANCE_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers[0]).toContain("尚未进行权限检测");
  });

  it("HTX 始终 observe-only", () => {
    const accounts = [makeAccount("htx")];
    const result = filterOpportunityByCapability(HTX_PATH, accounts);
    expect(result.executability).toBe("observable");
    expect(result.warnings.some((w) => w.includes("仅观察"))).toBe(true);
  });

  it("OKX 完整实现时 executable（无跨所权限）", () => {
    const accounts = [makeAccount("okx")];
    const result = filterOpportunityByCapability(
      { symbol: "BTC/USDT", spotExchange: "okx", perpExchange: "okx" },
      accounts,
    );
    expect(result.executability).toBe("executable");
    expect(result.blockers).toHaveLength(0);
  });
});

// ─── 跨所套利测试 ──────────────────────────────────

describe("opportunityCapabilityFilter — 跨所套利", () => {
  it("只有 Binance 时 blocked（缺 OKX 账户）", () => {
    const accounts = [makeAccount("binance", { crossExchange: true })];
    const result = filterOpportunityByCapability(CROSS_PATH, accounts);
    expect(result.isCrossExchange).toBe(true);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("合约侧未连接"))).toBe(true);
  });

  it("Binance + OKX 全权限但 crossExchangeArbEnabled=false 时 blocked", () => {
    const accounts = [
      makeAccount("binance", { crossExchange: true }),
      makeAccount("okx", { crossExchange: false }),
    ];
    const result = filterOpportunityByCapability(CROSS_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("跨所套利未启用"))).toBe(true);
  });

  it("跨所 crossExchangeArbEnabled=false 时 blocked（第一版默认关闭）", () => {
    // 用 Binance + Binance 模拟跨所（测试逻辑），实际跨所需要不同交易所
    // 这里用 binance spot + binance perp 不是跨所，所以用特殊路径
    const path: OpportunityPath = {
      symbol: "BTC/USDT",
      spotExchange: "binance",
      perpExchange: "binance",
    };
    // 这个实际是本所，跳过 — 跨所测试用 binance + okx 但 okx not_supported
    // crossExchangeArbEnabled=false 会阻塞
    const accounts = [
      makeAccount("binance", { crossExchange: false }),
      makeAccount("okx", { crossExchange: false }),
    ];
    const result = filterOpportunityByCapability(CROSS_PATH, accounts);
    expect(result.executability).toBe("blocked");
    // crossExchangeArbEnabled=false + perp 权限不足都会阻塞
    expect(result.blockers.some((b) => b.includes("跨所套利未启用"))).toBe(true);
  });

  it("跨所缺少 spot side 账户时 blocked", () => {
    const path: OpportunityPath = {
      symbol: "BTC/USDT",
      spotExchange: "okx",
      perpExchange: "binance",
    };
    const accounts = [makeAccount("binance", { crossExchange: true })];
    const result = filterOpportunityByCapability(path, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("现货侧未连接"))).toBe(true);
  });

  it("跨所 spot side 权限不足时 blocked", () => {
    const accounts = [
      makeAccount("binance", {
        crossExchange: true,
        capability: makeFullCapability("binance", { tradeSpot: false }),
      }),
      makeAccount("okx", { crossExchange: true }),
    ];
    const result = filterOpportunityByCapability(CROSS_PATH, accounts);
    expect(result.executability).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("现货侧权限不足"))).toBe(true);
  });

  it("跨所 perp side 权限不足时 blocked", () => {
    const accounts = [
      makeAccount("binance", { crossExchange: true }),
      makeAccount("okx", {
        crossExchange: true,
        capability: makeFullCapability("okx", { tradePerp: false }),
      }),
    ];
    const result = filterOpportunityByCapability(CROSS_PATH, accounts);
    expect(result.executability).toBe("blocked");
    // perp 权限不足会阻塞
    expect(result.blockers.some((b) => b.includes("合约侧权限不足"))).toBe(true);
  });
});

// ─── 批量过滤 + 聚合 ───────────────────────────────

describe("opportunityCapabilityFilter — 批量 + 聚合", () => {
  it("filterOpportunitiesByCapability 附加 capabilityResult", () => {
    const opps = [
      { path: { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance" } },
      { path: { symbol: "ETH/USDT", spotExchange: "okx", perpExchange: "okx" } },
    ];
    const accounts = [makeAccount("binance")];
    const results = filterOpportunitiesByCapability(opps, accounts);
    expect(results).toHaveLength(2);
    expect(results[0].capabilityResult.executability).toBe("executable");
    expect(results[1].capabilityResult.executability).toBe("blocked"); // 无 OKX 账户
  });

  it("aggregateCapability 统计本所/跨所可用性", () => {
    const results = [
      {
        opportunity: {},
        capabilityResult: {
          isCrossExchange: false,
          executability: "executable" as const,
          blockers: [],
          warnings: [],
        },
      },
      {
        opportunity: {},
        capabilityResult: {
          isCrossExchange: false,
          executability: "observable" as const,
          blockers: [],
          warnings: [],
        },
      },
      {
        opportunity: {},
        capabilityResult: {
          isCrossExchange: true,
          executability: "blocked" as const,
          blockers: ["test"],
          warnings: [],
        },
      },
    ];
    const agg = aggregateCapability(results);
    expect(agg.sameExchangeExecutable).toBe(1);
    expect(agg.sameExchangeObservable).toBe(1);
    expect(agg.crossExchangeBlocked).toBe(1);
    expect(agg.sameExchangeAvailable).toBe(true);
    expect(agg.crossExchangeAvailable).toBe(false);
  });

  it("aggregateCapability 全部 blocked 时 sameExchangeAvailable=false", () => {
    const results = [
      {
        opportunity: {},
        capabilityResult: {
          isCrossExchange: false,
          executability: "blocked" as const,
          blockers: ["no account"],
          warnings: [],
        },
      },
    ];
    const agg = aggregateCapability(results);
    expect(agg.sameExchangeAvailable).toBe(false);
    expect(agg.crossExchangeAvailable).toBe(false);
  });
});
