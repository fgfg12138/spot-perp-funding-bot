import { checkMainnetTinyGate } from "./mainnetTinyGate";
import { runMainnetTinyPreflight } from "./mainnetTinyPreflight";
import { getPersistenceMode, isPersistenceReadyForTiny } from "../persistence/persistenceMode";
import { getKillSwitch } from "../risk/killSwitch";
import { getRepository } from "../persistence/repositoryFactory";
import * as fs from "node:fs";
import * as path from "node:path";

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
  };
  chineseMessage: string;
}

export async function runFinalPreExecutionAudit(): Promise<FinalAuditResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const repo = getRepository();
  const gate = checkMainnetTinyGate();
  const preflight = runMainnetTinyPreflight();
  const ks = getKillSwitch();
  const persMode = getPersistenceMode();
  const realOrderEnabled = process.env.V121_REAL_ORDER_EXECUTION_ENABLED === "true";

  if (gate.mode !== "MAINNET_TINY") blockers.push("V121_MODE 未设为 MAINNET_TINY");
  if (!gate.allowed) blockers.push("环境门未满足");
  if (preflight.readinessScore < 80) warnings.push(`预飞分数 ${preflight.readinessScore} < 80`);
  if (preflight.criticalCount > 0) blockers.push(`${preflight.criticalCount} 项关键检查未通过`);
  if (!isPersistenceReadyForTiny()) blockers.push(`持久化 ${persMode}，需 sqlite-active`);
  let sqliteOk = false;
  try { repo.queryAll("latest_scan"); sqliteOk = true; } catch { sqliteOk = false; }
  if (!sqliteOk) blockers.push("SQLite 不可读");
  if (ks !== "OFF") blockers.push(`Kill Switch 为 ${ks}`);
  if (realOrderEnabled) warnings.push("V121_REAL_ORDER_EXECUTION_ENABLED=true — M9.4 应关闭");

  const hb = repo.latest("worker_heartbeat") as any;
  const hbTs = Number(hb?.lastCycleAtUtc ?? hb?.last_cycle_at_utc ?? 0);
  const hbAge = hbTs > 0 ? (Date.now() - hbTs) / 1000 : Infinity;
  if (hbAge > 120) warnings.push(`Worker 心跳 ${Math.round(hbAge)} 秒前`);

  const scan = repo.latest("latest_scan") as any;
  const scanTs = Number(scan?.scannedAtUtc ?? scan?.scanned_at_utc ?? 0);
  const scanAge = scanTs > 0 ? (Date.now() - scanTs) / 1000 : Infinity;
  if (scanAge > 300) blockers.push(`最新 scan ${Math.round(scanAge)} 秒前 > 5 分钟`);
  const ds = String(scan?.dataSource ?? scan?.data_source ?? "");
  if (!ds.includes("real_market")) blockers.push("数据源不是 real_market");

  const alerts = (repo.queryAll("opportunity_alerts") as any[]).filter(
    (a: any) => a.status === "new" || a.status === "acknowledged",
  );
  // 测试阈值告警不能用于真实 10U 验证
  const testAlerts = alerts.filter((a: any) => a.thresholdSource === "test_override" || a.isTestThreshold);
  const realAlerts = alerts.filter((a: any) => !testAlerts.includes(a));
  let capitalPrecheckPassed: boolean | undefined;
  let constraintPrecheckPassed: boolean | undefined;
  let orchestratorState: string | undefined;
  let orchestratorBlockers: string[] = [];
  if (realAlerts.length === 0 && testAlerts.length > 0) {
    blockers.push("当前机会来自测试阈值，不满足正式 0.05% 资金费门槛，不能进入真实 10U 套利验证。");
  } else if (alerts.length === 0) {
    blockers.push("无有效机会告警");
  }

  const intents = repo.queryAll("order_intents") as any[];
  if (intents.length === 0) warnings.push("无 dry-run intent 记录");
  // 如果最新 intent 是 rehearsal → 阻止真实 10U
  const latestIntent = intents.length > 0 ? intents[intents.length - 1] : null;
  if (latestIntent?.purpose === "execution_rehearsal" || latestIntent?.simulationOnly === true) {
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
        const decision = await runSafeExecutionDecision({
          intentId, exchange: exchange as any, symbol,
          plannedNotionalUsdt: notional,
          purpose: (latestIntent.purpose ?? (latestIntent.simulationOnly ? "execution_rehearsal" : "real_arbitrage")) as any,
          simulationOnly: latestIntent.simulationOnly === true || latestIntent.dryRun === true,
          realTradeEligible: latestIntent.realTradeEligible === true,
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

  const runbookOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_runbook.md"));
  const checklistOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_final_checklist.md"));

  // 修正 8: readyForManual10uApproval 需要 intent 存在 + orchestrator state 允许
  const safeDecisionReady = orchestratorState === "HUMAN_APPROVAL_REQUIRED" || orchestratorState === "FINAL_AUDIT_READY";
  const hasFormalIntent = !!latestIntent && !(latestIntent?.simulationOnly === true || latestIntent?.dryRun === true);

  return {
    readyForManual10uApproval: blockers.length === 0 && hasFormalIntent && safeDecisionReady,
    allowedForActualExecution: false,
    blockers, warnings,
    evidence: {
      mode: gate.mode, gateAllowed: gate.allowed,
      preflightScore: preflight.readinessScore,
      persistenceMode: persMode, sqliteWritable: sqliteOk,
      killSwitch: ks, realOrderExecutionEnabled: realOrderEnabled,
      latestWorkerHeartbeatAgeSec: hbAge < Infinity ? Math.round(hbAge) : undefined,
      latestScanAgeSec: scanAge < Infinity ? Math.round(scanAge) : undefined,
      latestScanDataSource: ds || undefined,
      activeOpportunityAlerts: alerts.length,
      latestDryRunIntent: intents.length > 0 ? intents[intents.length - 1] : null,
      blockedAttemptsCount: blocked.length,
      secretExposureCheck: secretOk ? "passed" : "failed",
      runbookExists: runbookOk, checklistExists: checklistOk,
      capitalPrecheckPassed, constraintPrecheckPassed,
      orchestratorState,
    },
    chineseMessage: blockers.length === 0
      ? "系统具备申请 10U 手动验证的条件，但当前不会真实下单。没有项目方单独批准，不允许进入 M9 actual execution。"
      : `系统尚未满足 10U 验证条件。阻塞项: ${blockers.join("；")}`,
  };
}
