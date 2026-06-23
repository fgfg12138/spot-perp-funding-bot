/**
 * CapabilityDetector — 只读探测交易所 API Key 权限。
 *
 * 通过 IAccountAdapter 的公共方法逐一探测每个权限维度。
 * 仅调用读取接口，不修改账户状态。
 */

import type { IAccountAdapter } from "../account/accountTypes";
import type {
  ExchangeCapability,
  CapabilityProbeResult,
  CapabilityProbeReport,
} from "./types";

// ─── Probe 定义 ─────────────────────────────────────

interface ProbeDefinition {
  name: string;
  /** 执行探测 */
  run: (adapter: IAccountAdapter) => Promise<boolean>;
  /** 探测成功后映射到 capability 的字段（healthCheck 不映射到具体权限） */
  capabilityField?: keyof ExchangeCapability;
}

/**
 * 所有探测项。按安全级别排列（读取优先，交易在后）。
 *
 * healthCheck 仅用于验证 API Key 连通性，不映射到具体权限字段。
 * 每个具体读取权限字段由其对应的探测项唯一决定。
 */
const READ_PROBES: ProbeDefinition[] = [
  {
    name: "healthCheck",
    run: async (a) => a.healthCheck(),
    // 不映射到具体权限字段（仅验证 API Key 有效性）
  },
  {
    name: "fetchBalances",
    run: async (a) => {
      const balances = await a.fetchBalances();
      return Array.isArray(balances) && balances.length > 0;
    },
    capabilityField: "readBalance",
  },
  {
    name: "fetchPositions",
    run: async (a) => {
      const positions = await a.fetchPositions();
      return Array.isArray(positions);
    },
    capabilityField: "positions",
  },
  {
    name: "fetchOpenOrders",
    run: async (a) => {
      const orders = await a.fetchOpenOrders();
      return Array.isArray(orders);
    },
    capabilityField: "orders",
  },
];

/**
 * 探测全部权限（读取类）。
 *
 * 目前只探测读取类权限（read_balance, positions, orders），
 * 交易类权限（trade_spot, trade_perp, internal_transfer, funding_rate）
 * 需要通过 attemptProbeTrade 或人工标记来确定。
 *
 * @param adapter   — 已构造好的 IAccountAdapter
 * @param accountId — 关联的 exchange_account 记录 ID
 * @returns CapabilityProbeReport
 */
export async function detectCapabilities(
  adapter: IAccountAdapter,
  accountId: string,
): Promise<CapabilityProbeReport> {
  const exchange = adapter.exchangeId;
  const probes: CapabilityProbeResult[] = [];
  const successMap = new Map<keyof ExchangeCapability, boolean>();

  for (const probe of READ_PROBES) {
    const start = Date.now();
    try {
      const success = await probe.run(adapter);
      probes.push({
        probe: probe.name,
        success,
        durationMs: Date.now() - start,
      });
      if (success && probe.capabilityField) {
        successMap.set(probe.capabilityField, true);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      probes.push({
        probe: probe.name,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - start,
      });
    }
  }

  const hasReadBalances = successMap.get("readBalance") ?? false;
  const hasPositions = successMap.get("positions") ?? false;
  const hasOrders = successMap.get("orders") ?? false;

  // 读取权限成功的推论
  const capability: ExchangeCapability = {
    accountId,
    exchange,
    readBalance: hasReadBalances,
    readSpot: hasReadBalances,   // 余额可读 → 假定现货可读（后续可细化）
    readPerp: hasReadBalances,   // 余额可读 → 假定合约可读
    tradeSpot: false,            // 需要额外探测或人工标记
    tradePerp: false,
    internalTransfer: false,
    fundingRate: false,
    positions: hasPositions,
    orders: hasOrders,
    sameExchangeArbEnabled: false, // 由 capabilityEngine 决定
    crossExchangeArbEnabled: false,
    lastCheckedAtUtc: new Date().toISOString(),
    rawJson: JSON.stringify(probes),
  };

  // 如果有探测失败的项，记录错误
  const failedProbes = probes.filter(p => !p.success);
  const lastError = failedProbes.length > 0
    ? failedProbes.map(p => `${p.probe}: ${p.error ?? "unknown"}`).join("; ")
    : undefined;

  return {
    accountId,
    exchange,
    probes,
    capability: { ...capability, lastError },
    timestampUtc: new Date().toISOString(),
  };
}
