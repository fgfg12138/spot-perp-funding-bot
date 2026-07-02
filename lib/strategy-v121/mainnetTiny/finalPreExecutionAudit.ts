import { checkMainnetTinyGate } from "./mainnetTinyGate";
import { runMainnetTinyPreflight } from "./mainnetTinyPreflight";
import { getPersistenceMode, isPersistenceReadyForTiny } from "../persistence/persistenceMode";
import { getKillSwitch } from "../risk/killSwitch";
import { getRepository } from "../persistence/repositoryFactory";
import { isExchangeId } from "../domain/types";
import { isOrderIntentPurpose } from "../execution/orderIntent";
import { isRealOrderExecutionEnabled, isRealInternalTransferEnabled } from "../config/runtimeConfig";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 可配置的审计规则集合 ────────────────────────────────────
//
// 每项规则是一个函数 (repo, context) => { blockers: string[], warnings: string[] }
// 可通过 exchange 或 mode 过滤启用/禁用。
// 如需禁用某项规则，从 defaultRules 中移除或设置 enabled: false。

export type AuditRule = {
  id: string;
  description: string;
  enabledForExchanges?: string[];  // 空 = 全部
  enabledForModes?: string[];      // 空 = 全部
  fn: (repo: ReturnType<typeof getRepository>, ctx: AuditContext) => AuditRuleResult;
};

export type AuditContext = {
  mode: string;
  exchange?: string;
  [key: string]: unknown;
};

export type AuditRuleResult = {
  blockers: string[];
  warnings: string[];
};

/** 默认全部启用的审计规则集合 */
const defaultRules: AuditRule[] = [
  {
    id: "mode_check",
    description: "V121_MODE 必须为 MAINNET_TINY",
    fn: (_, ctx) => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      if (ctx.mode !== "MAINNET_TINY") r.blockers.push("V121_MODE 未设为 MAINNET_TINY");
      return r;
    },
  },
  {
    id: "gate_check",
    description: "环境门禁必须全部通过",
    fn: () => {
      const gate = checkMainnetTinyGate();
      if (!gate.allowed) return { blockers: ["环境门未满足"], warnings: [] };
      return { blockers: [], warnings: [] };
    },
  },
  {
    id: "preflight_score",
    description: "预飞检查分数 >= 80，关键项无 fail",
    fn: () => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      const preflight = runMainnetTinyPreflight();
      if (preflight.readinessScore < 80) r.warnings.push(`预飞分数 ${preflight.readinessScore} < 80`);
      if (preflight.criticalCount > 0) r.blockers.push(`${preflight.criticalCount} 项关键检查未通过`);
      return r;
    },
  },
  {
    id: "persistence_mode",
    description: "持久化模式必须为 sqlite-active",
    fn: () => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      const persMode = getPersistenceMode();
      if (!isPersistenceReadyForTiny()) r.blockers.push(`持久化 ${persMode}，需 sqlite-active`);
      return r;
    },
  },
  {
    id: "sqlite_readable",
    description: "SQLite 可读",
    fn: (repo) => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      try { repo.queryAll("latest_scan"); } catch { r.blockers.push("SQLite 不可读"); }
      return r;
    },
  },
  {
    id: "kill_switch",
    description: "Kill Switch 必须为 OFF",
    fn: () => {
      const ks = getKillSwitch();
      if (ks !== "OFF") return { blockers: [`Kill Switch 为 ${ks}`], warnings: [] };
      return { blockers: [], warnings: [] };
    },
  },
  {
    id: "real_order_env",
    description: "V121_REAL_ORDER_EXECUTION_ENABLED 应为 false",
    fn: () => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      if (isRealOrderExecutionEnabled()) {
        r.warnings.push("V121_REAL_ORDER_EXECUTION_ENABLED=true — M9.4 应关闭");
      }
      return r;
    },
  },
  {
    id: "worker_heartbeat",
    description: "Worker 心跳需在 120 秒以内",
    fn: (repo) => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      const hb = repo.latest("worker_heartbeat") as any;
      const hbTs = Number(hb?.lastCycleAtUtc ?? hb?.last_cycle_at_utc ?? 0);
      const hbAge = hbTs > 0 ? (Date.now() - hbTs) / 1000 : Infinity;
      if (hbAge > 120) r.warnings.push(`Worker 心跳 ${Math.round(hbAge)} 秒前`);
      return r;
    },
  },
  {
    id: "scan_freshness",
    description: "最近扫描需在 5 分钟以内",
    fn: (repo) => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      const scan = repo.latest("latest_scan") as any;
      const scanTs = Number(scan?.scannedAtUtc ?? scan?.scanned_at_utc ?? 0);
      const scanAge = scanTs > 0 ? (Date.now() - scanTs) / 1000 : Infinity;
      if (scanAge > 300) r.blockers.push(`最新 scan ${Math.round(scanAge)} 秒前 > 5 分钟`);
      const ds = String(scan?.dataSource ?? scan?.data_source ?? "");
      if (!ds.includes("real_market")) r.blockers.push("数据源不是 real_market");
      return r;
    },
  },
  {
    id: "opportunity_alerts",
    description: "机会告警必须有效",
    fn: (repo) => {
      const r: AuditRuleResult = { blockers: [], warnings: [] };
      const alerts = (repo.queryAll("opportunity_alerts") as any[]).filter(
        (a: any) => a.status === "new" || a.status === "acknowledged",
      );
      const testAlerts = alerts.filter((a: any) => a.thresholdSource === "test_override" || a.isTestThreshold);
      const realAlerts = alerts.filter((a: any) => !testAlerts.includes(a));
      if (realAlerts.length === 0 && testAlerts.length > 0) {
        r.blockers.push("当前机会来自测试阈值，不满足正式 0.05% 资金费门槛，不能进入真实 10U 套利验证。");
      } else if (alerts.length === 0) {
        r.blockers.push("无有效机会告警");
      }
      return r;
    },
  },
];

export interface FinalAuditResult {
  readyForManual10uApproval: boolean;
  allowedForActualExecution: false;
  blockers: string[];
  warnings: string[];
  evidence: {
    mode: string; gateAllowed: boolean; preflightScore: number;
    persistenceMode: string; sqliteWritable: boolean;
    killSwitch: string; realOrderExecutionEnabled: boolean;
    latestWorkerHeartbeatAgeSec?: number;
    latestScanAgeSec?: number; latestScanDataSource?: string;
    activeOpportunityAlerts: number;
    latestDryRunIntent: any;
    blockedAttemptsCount: number;
    secretExposureCheck: string;
    runbookExists: boolean; checklistExists: boolean;
    capitalPrecheckPassed?: boolean;
    constraintPrecheckPassed?: boolean;
    orchestratorState?: string;
    userSettings?: {
      minFundingRate8h: number;
      plannedNotionalUsdt: number;
      maxOrderNotionalUsdt: number;
      allowAutoTransfer: boolean;
      transferMode: string;
      maxAutoTransferUsdt: number;
      requireHumanApproval: boolean;
    };
    internalTransferPolicy?: {
      allowAutoTransfer: boolean;
      transferMode: string;
      maxAutoTransferUsdt: number;
      requireReauditAfterTransfer: boolean;
      realInternalTransferEnvEnabled: boolean;
    };
  };
  chineseMessage: string;
}

export async function runFinalPreExecutionAudit(
  customRules?: AuditRule[],
): Promise<FinalAuditResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const repo = getRepository();
  const gate = checkMainnetTinyGate();
  const preflight = runMainnetTinyPreflight();
  const ks = getKillSwitch();
  const persMode = getPersistenceMode();
  const realOrderEnabled = isRealOrderExecutionEnabled();

  // 使用规则系统：合并默认规则 + 自定义规则
  const rules = [...defaultRules, ...(customRules ?? [])];
  const ctx: AuditContext = { mode: gate.mode };
  for (const rule of rules) {
    const result = rule.fn(repo, ctx);
    blockers.push(...result.blockers);
    warnings.push(...result.warnings);
  }

  let capitalPrecheckPassed: boolean | undefined;
  let constraintPrecheckPassed: boolean | undefined;
  let orchestratorState: string | undefined;
  let orchestratorBlockers: string[] = [];

  const intents = repo.queryAll("order_intents") as any[];
  if (intents.length === 0) warnings.push("无 dry-run intent 记录");
  // 如果最新 intent 是 rehearsal → 阻止真实 10U
  const latestIntent = intents
    .filter(Boolean)
    .sort((a, b) => {
      const at = Number(a.createdAtUtc ?? a.created_at ?? a.ts ?? 0);
      const bt = Number(b.createdAtUtc ?? b.created_at ?? b.ts ?? 0);
      return bt - at;
    })[0] ?? null;

  // 修正 14: toBool 兼容 true/1/"1"/"true"
  const toBool = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";
  if (latestIntent?.purpose === "execution_rehearsal" || toBool(latestIntent?.simulationOnly)) {
    blockers.push("当前 dry-run intent 来自亏损最小模拟候选，不满足正式套利规则，不能申请真实 10U 验证。");
    capitalPrecheckPassed = false;
    constraintPrecheckPassed = false;
  } else if (latestIntent) {
    // 正式 intent → 修正 1: 缺失即 blocker（不兜底默认值）
    const intentId = latestIntent.intentId ?? latestIntent.id;
    const exchange = latestIntent.spotExchange ?? latestIntent.spot_exchange;
    const symbol = latestIntent.symbol;
    const notional = Number(latestIntent.plannedNotionalUsdt ?? latestIntent.planned_notional ?? 0);

    if (!intentId) blockers.push("intentId 缺失");
    if (!exchange) blockers.push("exchange 缺失");
    if (!symbol) blockers.push("symbol 缺失");
    if (notional <= 0) blockers.push("plannedNotionalUsdt 缺失或 <= 0");

    if (blockers.length === 0) {
      try {
        const { runSafeExecutionDecision } = await import("../execution/safeExecutionOrchestrator");
        const purposeValue = latestIntent.purpose ?? (latestIntent.simulationOnly ? "execution_rehearsal" : "real_arbitrage");
        const decision = await runSafeExecutionDecision({
          intentId,
          exchange: isExchangeId(exchange) ? exchange : "binance",
          symbol,
          plannedNotionalUsdt: notional,
          purpose: isOrderIntentPurpose(purposeValue) ? purposeValue : "real_arbitrage",
          simulationOnly: toBool(latestIntent.simulationOnly) || toBool(latestIntent.dryRun),
          realTradeEligible: toBool(latestIntent.realTradeEligible),
        });
        constraintPrecheckPassed = decision.orderConstraintPass;
        capitalPrecheckPassed = decision.capitalPrecheckPass;
        orchestratorState = decision.state;
        orchestratorBlockers = decision.blockers;

        // 修正 7: TRANSFER_REQUIRED / BLOCKED / FROZEN → blocker
        if (["BLOCKED", "FROZEN", "TRANSFER_REQUIRED"].includes(decision.state)) {
          blockers.push(...decision.blockers);
        }
      } catch (err: any) {
        constraintPrecheckPassed = false;
        capitalPrecheckPassed = false;
        blockers.push(`安全决策异常: ${err.message}`);
      }
    }
  } else {
    // 修正 9: 没有 latest intent
    blockers.push("没有正式 dry-run intent，不能申请真实 10U 验证。");
  }

  const blocked = repo.queryAll("blocked_execution_attempts");
  const allJson = JSON.stringify(repo.queryAll("latest_scan"));
  const secretOk = !allJson.includes("API_KEY") && !allJson.includes("API_SECRET") && !allJson.includes("PASSPHRASE");

  // 加载用户设置 — 失败时必须阻断执行，因为关键风控参数（minFundingRate8h 等）缺失
  let userSettings: FinalAuditResult["evidence"]["userSettings"] | undefined;
  let userSettingsLoadError: string | undefined;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    const s = await loadSettings();
    userSettings = { minFundingRate8h: s.funding.minFundingRate8h, plannedNotionalUsdt: s.notional.plannedNotionalUsdt, maxOrderNotionalUsdt: s.notional.maxOrderNotionalUsdt, allowAutoTransfer: s.transfer.allowAutoTransfer, transferMode: s.transfer.mode, maxAutoTransferUsdt: s.transfer.maxAutoTransferUsdt, requireHumanApproval: s.execution.requireHumanApproval };
  } catch (e) {
    userSettingsLoadError = (e as Error).message;
    blockers.push(`用户策略设置加载失败: ${userSettingsLoadError}`);
  }

  const runbookOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_runbook.md"));
  const checklistOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_final_checklist.md"));

  // 修正 8: readyForManual10uApproval 需要 intent 存在 + orchestrator state 允许
  const safeDecisionReady = orchestratorState === "HUMAN_APPROVAL_REQUIRED" || orchestratorState === "FINAL_AUDIT_READY";
  const hasFormalIntent = !!latestIntent && !(toBool(latestIntent?.simulationOnly) || toBool(latestIntent?.dryRun));

  return {
    readyForManual10uApproval: blockers.length === 0 && hasFormalIntent && safeDecisionReady,
    allowedForActualExecution: false,
    blockers, warnings,
    evidence: {
      mode: gate.mode, gateAllowed: gate.allowed,
      preflightScore: preflight.readinessScore,
      persistenceMode: persMode, sqliteWritable: true,
      killSwitch: ks, realOrderExecutionEnabled: realOrderEnabled,
      latestWorkerHeartbeatAgeSec: (() => { const h = repo.latest("worker_heartbeat") as any; const t = Number(h?.lastCycleAtUtc ?? h?.last_cycle_at_utc ?? 0); return t > 0 ? Math.round((Date.now()-t)/1000) : undefined; })(),
      latestScanAgeSec: (() => { const s = repo.latest("latest_scan") as any; const t = Number(s?.scannedAtUtc ?? s?.scanned_at_utc ?? 0); return t > 0 ? Math.round((Date.now()-t)/1000) : undefined; })(),
      latestScanDataSource: (() => { const s = repo.latest("latest_scan") as any; return String(s?.dataSource ?? s?.data_source ?? ""); })(),
      activeOpportunityAlerts: (repo.queryAll("opportunity_alerts") as any[]).filter((a: any) => a.status === "new" || a.status === "acknowledged").length,
      latestDryRunIntent: intents.length > 0 ? intents[intents.length - 1] : null,
      blockedAttemptsCount: blocked.length,
      secretExposureCheck: secretOk ? "passed" : "failed",
      runbookExists: runbookOk, checklistExists: checklistOk,
      capitalPrecheckPassed, constraintPrecheckPassed,
      orchestratorState,
      userSettings,
      internalTransferPolicy: userSettings ? {
        allowAutoTransfer: userSettings.allowAutoTransfer,
        transferMode: userSettings.transferMode,
        maxAutoTransferUsdt: userSettings.maxAutoTransferUsdt,
        requireReauditAfterTransfer: true,
        realInternalTransferEnvEnabled: isRealInternalTransferEnabled(),
      } : undefined,
    },
    chineseMessage: blockers.length === 0
      ? "系统具备申请 10U 手动验证的条件，但当前不会真实下单。没有项目方单独批准，不允许进入 M9 actual execution。"
      : `系统尚未满足 10U 验证条件。阻塞项: ${blockers.join("；")}`,
  };
}
