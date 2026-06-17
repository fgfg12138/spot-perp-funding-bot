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
  };
  chineseMessage: string;
}

export function runFinalPreExecutionAudit(): FinalAuditResult {
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

  const hb = repo.latest("worker_heartbeats") as any;
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
  if (alerts.length === 0) blockers.push("无有效机会告警");

  const intents = repo.queryAll("order_intents") as any[];
  if (intents.length === 0) warnings.push("无 dry-run intent 记录");

  const blocked = repo.queryAll("blocked_execution_attempts");
  const allJson = JSON.stringify(repo.queryAll("latest_scan"));
  const secretOk = !allJson.includes("API_KEY") && !allJson.includes("API_SECRET") && !allJson.includes("PASSPHRASE");

  const runbookOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_runbook.md"));
  const checklistOk = fs.existsSync(path.join(process.cwd(), "docs/mainnet_tiny_final_checklist.md"));

  return {
    readyForManual10uApproval: blockers.length === 0,
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
    },
    chineseMessage: blockers.length === 0
      ? "系统具备申请 10U 手动验证的条件，但当前不会真实下单。没有项目方单独批准，不允许进入 M9 actual execution。"
      : `系统尚未满足 10U 验证条件。阻塞项: ${blockers.join("；")}`,
  };
}
