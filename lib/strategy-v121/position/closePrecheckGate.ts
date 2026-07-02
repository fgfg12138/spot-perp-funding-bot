/**
 * 平仓前置门控 — 在生成 ClosePlan / 执行真实平仓前的硬性校验。
 *
 * 严格边界（与开仓侧 preOrderExecutionGate 对称）：
 * - 只支持 Binance 同所现货-永续套利；OKX / HTX / 跨所 → not_supported。
 * - 系统记录仓位必须处于可平状态（OPEN / MONITORING）。
 * - 一级冻结禁止 normal_tp（仅允许 hard_stop_loss / margin_risk）；
 *   二级冻结禁止一切自动平仓（仅允许 cancel / alert / wait）。
 * - kill switch：EXIT 在 PAUSE_NEW_ENTRIES 下仍允许，PAUSE_ALL_AUTOMATION 下禁止。
 * - 真实平仓门控独立于开仓门控（V121_ENABLE_REAL_CLOSE_EXECUTION）。
 *
 * 门控只返回 blockers / warnings，不抛异常；调用方据此决定是否生成方案或执行。
 */
import type { PaperExecution } from "../execution/paperLifecycle";
import type { ExchangeAccountSnapshot } from "./closeExecutionTypes";
import {
  getRuntimeConfig,
  isRealCloseExecutionEnabled,
} from "../config/runtimeConfig";

export interface ClosePrecheckInput {
  /** 系统记录仓位（PaperExecution，仅作"谁/从哪来"参考）。 */
  position: PaperExecution;
  /** 交易所账户快照（真实数据，ground truth）。 */
  exchangeSnapshot: ExchangeAccountSnapshot;
  /** 平仓触发原因：normal_tp / hard_stop_loss / margin_risk / manual。 */
  triggerReason?: "normal_tp" | "hard_stop_loss" | "margin_risk" | "manual";
  /** kill switch 状态（来自 env 或运行时）。 */
  killSwitch?: string;
  /** 冻结等级（来自 evaluateFreezeState）。 */
  freezeLevel?: "none" | "level1" | "level2";
  /** 是否真实平仓（dryRun=false 时校验 env gate）。 */
  realCloseEnabled?: boolean;
}

export interface ClosePrecheckResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

const CLOSEABLE_STATES = ["OPEN", "MONITORING"];

/**
 * 运行平仓前置门控。返回 blockers / warnings，ok = blockers.length === 0。
 */
export function runClosePrecheckGate(input: ClosePrecheckInput): ClosePrecheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const pos = input.position;
  const snap = input.exchangeSnapshot;
  const trigger = input.triggerReason ?? "manual";

  // 1. 系统记录仓位状态：必须是可平状态
  if (!CLOSEABLE_STATES.includes(pos.state)) {
    blockers.push(`position state ${pos.state} not closeable`);
  }

  // 2. 交易所边界：支持 Binance 和 OKX 同所平仓，阻止跨所
  const sup = (ex: string) => ex === "binance" || ex === "okx";
  if (!sup(pos.path.spotExchange) || !sup(pos.path.perpExchange)) {
    blockers.push(
      `exchange not supported: spot=${pos.path.spotExchange}, perp=${pos.path.perpExchange}`,
    );
  }
  if (pos.path.isCrossExchange) {
    blockers.push("cross-exchange close not supported");
  }
  if (!sup(snap.exchange)) {
    blockers.push(`snapshot exchange ${snap.exchange} not supported`);
  }

  // 3. 系统记录与交易所快照 symbol 一致性
  if (snap.perpShortPosition && snap.perpShortPosition.symbol !== pos.path.symbol) {
    blockers.push(
      `symbol mismatch: system=${pos.path.symbol}, exchange=${snap.perpShortPosition.symbol}`,
    );
  }

  // 4. 交易所真实仓位：永续 SHORT 必须存在
  if (!snap.perpShortPosition || snap.perpShortPosition.quantity <= 0) {
    blockers.push("no perp short position on exchange");
  }

  // 5. 交易所真实余额：现货必须可卖
  if (!snap.spotBalance || snap.spotBalance.free <= 0) {
    blockers.push("no spot balance to sell on exchange");
  }

  // 6. kill switch
  const ks = input.killSwitch ?? getRuntimeConfig().killSwitchFallback;
  if (ks === "PAUSE_ALL_AUTOMATION") {
    blockers.push("kill switch PAUSE_ALL_AUTOMATION blocks all close");
  } else if (ks === "READ_ONLY_ONLY") {
    blockers.push("kill switch READ_ONLY_ONLY blocks real close");
  }
  // PAUSE_NEW_ENTRIES 下 EXIT 仍允许 → 不 block

  // 7. 冻结等级
  const freeze = input.freezeLevel ?? "none";
  if (freeze === "level2") {
    // 二级冻结：仅允许 cancel / alert / wait，禁止一切自动平仓
    blockers.push("freeze level2: only cancel/alert/wait allowed");
  } else if (freeze === "level1") {
    // 一级冻结：禁止 normal_tp，仅允许 hard_stop_loss / margin_risk / manual
    if (trigger === "normal_tp") {
      blockers.push("freeze level1: normal_tp blocked, only hard_stop_loss/margin_risk allowed");
    }
  }

  // 8. 挂单冲突：同 symbol 存在挂单时警告（平仓 MARKET 单通常仍可成交，但需提示）
  const conflictOrders = snap.openOrders.filter(
    (o) => o.symbol === pos.path.symbol,
  );
  if (conflictOrders.length > 0) {
    warnings.push(`${conflictOrders.length} open orders for ${pos.path.symbol}`);
  }

  // 9. 真实平仓门控（仅 realCloseEnabled=true 时校验 env）
  if (input.realCloseEnabled) {
    if (!isRealCloseExecutionEnabled()) {
      blockers.push("V121_ENABLE_REAL_CLOSE_EXECUTION not set");
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
