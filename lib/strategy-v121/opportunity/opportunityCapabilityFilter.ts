/**
 * Opportunity Capability Filter — 根据交易所账户能力判断机会可执行性。
 *
 * 输入：opportunity + 用户绑定的交易所账户能力列表
 * 输出：executable / observable / blocked + blockers + warnings
 *
 * 规则：
 *  - 本所套利（spotExchange === perpExchange）：
 *    需要该 exchange 存在 enabled account，
 *    且满足 readBalance + readSpot + readPerp + tradeSpot + tradePerp + positions + fundingRate。
 *  - 跨所套利（spotExchange !== perpExchange）：
 *    spot side 需要 readBalance + readSpot + tradeSpot；
 *    perp side 需要 readBalance + readPerp + tradePerp + positions + fundingRate；
 *    两边账户都 enabled；
 *    crossExchangeArbEnabled 必须为 true（第一版默认关闭，只显示候选）。
 *  - HTX 始终 observe-only，不允许真实执行。
 *  - OKX 运行时完整实现，支持下单/划转。
 */

import type { ExchangeId } from "../domain/types";
import type { ExchangeCapability } from "../exchange-accounts/types";

// ─── 输入类型 ───────────────────────────────────────

/** 机会路径信息（从 opportunity.path 提取）。 */
export interface OpportunityPath {
  symbol: string;
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
}

/** 账户摘要（从 exchange-accounts API 提取，含 capability）。 */
export interface AccountCapabilitySummary {
  id: string;
  exchange: ExchangeId;
  enabled: boolean;
  capability?: ExchangeCapability;
}

/** 交易所运行时支持状态（来自 runtimeAdapterFactory 的 status 映射）。 */
export type ExchangeRuntimeSupport = "ok" | "not_supported" | "observe_only";

// ─── 输出类型 ───────────────────────────────────────

export type OpportunityExecutability = "executable" | "observable" | "blocked";

export interface OpportunityCapabilityResult {
  /** 是否本所套利。 */
  isCrossExchange: boolean;
  /** 可执行性。 */
  executability: OpportunityExecutability;
  /** 阻塞原因（blocked 时填充）。 */
  blockers: string[];
  /** 警告（observable 时填充）。 */
  warnings: string[];
  /** 使用的 spot side 账户 ID（如有）。 */
  spotAccountId?: string;
  /** 使用的 perp side 账户 ID（如有）。 */
  perpAccountId?: string;
}

// ─── 运行时支持状态映射 ─────────────────────────────

/**
 * 交易所运行时支持状态。
 * Binance=ok, OKX=ok（完整实现）, HTX=observe_only。
 */
const RUNTIME_SUPPORT: Record<ExchangeId, ExchangeRuntimeSupport> = {
  binance: "ok",
  okx: "ok",
  htx: "observe_only",
};

// ─── 辅助函数 ───────────────────────────────────────

/** 从账户能力列表中找到某交易所的 enabled 账户。 */
function findEnabledAccount(
  accounts: AccountCapabilitySummary[],
  exchange: ExchangeId,
): AccountCapabilitySummary | undefined {
  return accounts.find((a) => a.exchange === exchange && a.enabled);
}

/** 检查某交易所是否具备本所套利所需全部权限。 */
function checkSameExchangePermissions(
  cap: ExchangeCapability,
): { ok: boolean; missing: string[] } {
  const required: Array<[keyof ExchangeCapability, string]> = [
    ["readBalance", "读取余额"],
    ["readSpot", "读取现货"],
    ["readPerp", "读取合约"],
    ["tradeSpot", "现货交易"],
    ["tradePerp", "合约交易"],
    ["positions", "持仓查询"],
    ["fundingRate", "资金费率"],
  ];
  const missing: string[] = [];
  for (const [key, label] of required) {
    if (!cap[key]) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

/** 检查 spot side 权限。 */
function checkSpotSidePermissions(
  cap: ExchangeCapability,
): { ok: boolean; missing: string[] } {
  const required: Array<[keyof ExchangeCapability, string]> = [
    ["readBalance", "读取余额"],
    ["readSpot", "读取现货"],
    ["tradeSpot", "现货交易"],
  ];
  const missing: string[] = [];
  for (const [key, label] of required) {
    if (!cap[key]) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

/** 检查 perp side 权限。 */
function checkPerpSidePermissions(
  cap: ExchangeCapability,
): { ok: boolean; missing: string[] } {
  const required: Array<[keyof ExchangeCapability, string]> = [
    ["readBalance", "读取余额"],
    ["readPerp", "读取合约"],
    ["tradePerp", "合约交易"],
    ["positions", "持仓查询"],
    ["fundingRate", "资金费率"],
  ];
  const missing: string[] = [];
  for (const [key, label] of required) {
    if (!cap[key]) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

// ─── 核心过滤函数 ───────────────────────────────────

/**
 * 根据账户能力判断单个机会的可执行性。
 *
 * @param path        - 机会路径
 * @param accounts    - 用户绑定的交易所账户能力列表
 * @returns OpportunityCapabilityResult
 */
export function filterOpportunityByCapability(
  path: OpportunityPath,
  accounts: AccountCapabilitySummary[],
): OpportunityCapabilityResult {
  const isCrossExchange = path.spotExchange !== path.perpExchange;
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ─── 本所套利 ─────────────────────────────────────
  if (!isCrossExchange) {
    const exchange = path.spotExchange;
    const account = findEnabledAccount(accounts, exchange);

    if (!account) {
      blockers.push(`未连接 ${exchange.toUpperCase()} 账户或账户已停用`);
      return { isCrossExchange: false, executability: "blocked", blockers, warnings };
    }

    // HTX 始终 observe-only
    if (RUNTIME_SUPPORT[exchange] === "observe_only") {
      warnings.push("HTX 为仅观察模式，不可执行套利");
      return {
        isCrossExchange: false,
        executability: "observable",
        blockers,
        warnings,
        spotAccountId: account.id,
        perpAccountId: account.id,
      };
    }

    // OKX runtime adapter 未支持
    if (RUNTIME_SUPPORT[exchange] === "not_supported") {
      blockers.push("OKX 暂不支持该交易所执行");
      return {
        isCrossExchange: false,
        executability: "blocked",
        blockers,
        warnings,
        spotAccountId: account.id,
        perpAccountId: account.id,
      };
    }

    // 检查权限
    if (!account.capability) {
      blockers.push("尚未进行权限检测，请前往设置页检测权限");
      return {
        isCrossExchange: false,
        executability: "blocked",
        blockers,
        warnings,
        spotAccountId: account.id,
        perpAccountId: account.id,
      };
    }

    const permCheck = checkSameExchangePermissions(account.capability);
    if (!permCheck.ok) {
      // 如果只有只读权限（有 readBalance 但缺 trade 权限），则 observable
      const hasTrade = account.capability.tradeSpot || account.capability.tradePerp;
      if (!hasTrade && account.capability.readBalance) {
        warnings.push(`权限不足（缺少: ${permCheck.missing.join("、")}），仅可观察`);
        return {
          isCrossExchange: false,
          executability: "observable",
          blockers,
          warnings,
          spotAccountId: account.id,
          perpAccountId: account.id,
        };
      }
      blockers.push(`权限不足（缺少: ${permCheck.missing.join("、")}）`);
      return {
        isCrossExchange: false,
        executability: "blocked",
        blockers,
        warnings,
        spotAccountId: account.id,
        perpAccountId: account.id,
      };
    }

    return {
      isCrossExchange: false,
      executability: "executable",
      blockers,
      warnings,
      spotAccountId: account.id,
      perpAccountId: account.id,
    };
  }

  // ─── 跨所套利 ─────────────────────────────────────
  const spotAccount = findEnabledAccount(accounts, path.spotExchange);
  const perpAccount = findEnabledAccount(accounts, path.perpExchange);

  if (!spotAccount) {
    blockers.push(`现货侧未连接 ${path.spotExchange.toUpperCase()} 账户或账户已停用`);
  }
  if (!perpAccount) {
    blockers.push(`合约侧未连接 ${path.perpExchange.toUpperCase()} 账户或账户已停用`);
  }

  if (blockers.length > 0) {
    return { isCrossExchange: true, executability: "blocked", blockers, warnings };
  }

  // HTX observe-only（任一侧是 HTX）
  if (RUNTIME_SUPPORT[path.spotExchange] === "observe_only") {
    blockers.push("HTX 为仅观察模式，不可执行跨所套利");
  }
  if (RUNTIME_SUPPORT[path.perpExchange] === "observe_only") {
    blockers.push("HTX 为仅观察模式，不可执行跨所套利");
  }

  // OKX runtime adapter 未支持
  if (RUNTIME_SUPPORT[path.spotExchange] === "not_supported") {
    blockers.push("OKX 暂不支持该交易所执行");
  }
  if (RUNTIME_SUPPORT[path.perpExchange] === "not_supported") {
    blockers.push("OKX 暂不支持该交易所执行");
  }

  // 权限检查
  if (spotAccount!.capability) {
    const spotCheck = checkSpotSidePermissions(spotAccount!.capability);
    if (!spotCheck.ok) {
      blockers.push(`现货侧权限不足（缺少: ${spotCheck.missing.join("、")}）`);
    }
  } else {
    blockers.push("现货侧尚未进行权限检测");
  }

  if (perpAccount!.capability) {
    const perpCheck = checkPerpSidePermissions(perpAccount!.capability);
    if (!perpCheck.ok) {
      blockers.push(`合约侧权限不足（缺少: ${perpCheck.missing.join("、")}）`);
    }
  } else {
    blockers.push("合约侧尚未进行权限检测");
  }

  // crossExchangeArbEnabled 必须为 true
  // 第一版跨所真实执行默认关闭，只显示候选和原因
  const spotCrossEnabled = spotAccount!.capability?.crossExchangeArbEnabled ?? false;
  const perpCrossEnabled = perpAccount!.capability?.crossExchangeArbEnabled ?? false;
  if (!spotCrossEnabled || !perpCrossEnabled) {
    blockers.push("跨所套利未启用（当前版本默认关闭，仅显示候选）");
  }

  if (blockers.length > 0) {
    return {
      isCrossExchange: true,
      executability: "blocked",
      blockers,
      warnings,
      spotAccountId: spotAccount?.id,
      perpAccountId: perpAccount?.id,
    };
  }

  return {
    isCrossExchange: true,
    executability: "executable",
    blockers,
    warnings,
    spotAccountId: spotAccount?.id,
    perpAccountId: perpAccount?.id,
  };
}

// ─── 批量过滤 ───────────────────────────────────────

export interface OpportunityWithCapability {
  opportunity: any;
  capabilityResult: OpportunityCapabilityResult;
}

/**
 * 批量过滤机会列表，附加可执行性判断。
 */
export function filterOpportunitiesByCapability(
  opportunities: any[],
  accounts: AccountCapabilitySummary[],
): OpportunityWithCapability[] {
  return opportunities.map((opp) => {
    const path: OpportunityPath = {
      symbol: opp.path?.symbol ?? opp.symbol ?? "—",
      spotExchange: opp.path?.spotExchange ?? opp.spotExchange,
      perpExchange: opp.path?.perpExchange ?? opp.perpExchange,
    };
    const capabilityResult = filterOpportunityByCapability(path, accounts);
    return { opportunity: opp, capabilityResult };
  });
}

// ─── 聚合统计 ───────────────────────────────────────

export interface CapabilityAggregate {
  sameExchangeExecutable: number;
  sameExchangeObservable: number;
  sameExchangeBlocked: number;
  crossExchangeExecutable: number;
  crossExchangeObservable: number;
  crossExchangeBlocked: number;
  /** 本所套利是否有可执行账户。 */
  sameExchangeAvailable: boolean;
  /** 跨所套利是否有可执行账户（第一版默认 false）。 */
  crossExchangeAvailable: boolean;
}

/**
 * 聚合统计本所/跨所套利可用性。
 */
export function aggregateCapability(
  results: OpportunityWithCapability[],
): CapabilityAggregate {
  const agg: CapabilityAggregate = {
    sameExchangeExecutable: 0,
    sameExchangeObservable: 0,
    sameExchangeBlocked: 0,
    crossExchangeExecutable: 0,
    crossExchangeObservable: 0,
    crossExchangeBlocked: 0,
    sameExchangeAvailable: false,
    crossExchangeAvailable: false,
  };

  for (const r of results) {
    if (r.capabilityResult.isCrossExchange) {
      if (r.capabilityResult.executability === "executable") agg.crossExchangeExecutable++;
      else if (r.capabilityResult.executability === "observable") agg.crossExchangeObservable++;
      else agg.crossExchangeBlocked++;
    } else {
      if (r.capabilityResult.executability === "executable") agg.sameExchangeExecutable++;
      else if (r.capabilityResult.executability === "observable") agg.sameExchangeObservable++;
      else agg.sameExchangeBlocked++;
    }
  }

  agg.sameExchangeAvailable = agg.sameExchangeExecutable > 0;
  agg.crossExchangeAvailable = agg.crossExchangeExecutable > 0;

  return agg;
}
