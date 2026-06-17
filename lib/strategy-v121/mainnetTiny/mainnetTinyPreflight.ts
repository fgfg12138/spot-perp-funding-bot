import { checkMainnetTinyGate } from "./mainnetTinyGate";
import { getKillSwitch } from "../risk/killSwitch";
import { getPersistenceMode, isPersistenceReadyForTiny } from "../persistence/persistenceMode";
import { getRepository } from "../persistence/repositoryFactory";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  severity: "info" | "warning" | "critical";
  chineseMessage: string;
}

export interface PreflightResult {
  allowedForActualExecution: false;
  readinessScore: number;
  criticalCount: number;
  warningCount: number;
  checks: PreflightCheck[];
}

export function runMainnetTinyPreflight(): PreflightResult {
  const checks: PreflightCheck[] = [];
  const repo = getRepository();

  // 1. Env gate
  const gate = checkMainnetTinyGate();
  checks.push({
    name: "环境变量门",
    passed: gate.allowed,
    severity: "critical",
    chineseMessage: gate.allowed ? "环境变量门满足" : `缺失: ${gate.missing.join(", ")}`,
  });

  // 2. Kill Switch
  const ks = getKillSwitch();
  checks.push({
    name: "Kill Switch",
    passed: ks === "OFF",
    severity: "critical",
    chineseMessage: ks === "OFF" ? "Kill Switch 已关闭" : `Kill Switch 为 ${ks}`,
  });

  // 3. Persistence
  const persMode = getPersistenceMode();
  checks.push({
    name: "持久化模式",
    passed: isPersistenceReadyForTiny(),
    severity: "critical",
    chineseMessage: persMode === "sqlite-active" ? "sqlite-active" : `${persMode}`,
  });

  // 4. Latest scan
  const scan = repo.latest("latest_scan");
  const scanTs = Number((scan as any)?.scannedAtUtc ?? (scan as any)?.scanned_at_utc ?? 0);
  const scanAge = scanTs > 0 ? Date.now() - scanTs : Infinity;
  const scanTime = scanTs > 0 ? new Date(scanTs).toLocaleString("zh-CN") : "未知";
  checks.push({
    name: "最近扫描",
    passed: scanTs > 0 && scanAge < 5 * 60 * 1000,
    severity: "warning",
    chineseMessage: scanTs > 0 ? `${scanTime} (${Math.round(scanAge / 1000)}秒前)` : "无扫描记录",
  });

  // 5. Worker heartbeat
  const hb = repo.latest("worker_heartbeats");
  const hbTs = Number((hb as any)?.lastCycleAtUtc ?? (hb as any)?.last_cycle_at_utc ?? 0);
  const hbAge = hbTs > 0 ? Date.now() - hbTs : Infinity;
  checks.push({
    name: "Worker 心跳",
    passed: hbTs > 0 && hbAge < 60 * 1000,
    severity: "warning",
    chineseMessage: hbTs > 0 ? `${Math.round(hbAge / 1000)}秒前` : "无",
  });

  // 6. Secret check
  const scanData = repo.queryAll("latest_scan");
  const jsonStr = JSON.stringify(scanData);
  const secretOk = !jsonStr.includes("API_KEY") && !jsonStr.includes("API_SECRET") && !jsonStr.includes("PASSPHRASE");
  checks.push({
    name: "Secret 泄露检查",
    passed: secretOk,
    severity: "critical",
    chineseMessage: secretOk ? "通过" : "⚠️ 风险",
  });

  const passed = checks.filter(c => c.passed).length;
  return {
    allowedForActualExecution: false,
    readinessScore: Math.round((passed / checks.length) * 100),
    criticalCount: checks.filter(c => c.severity === "critical" && !c.passed).length,
    warningCount: checks.filter(c => c.severity === "warning" && !c.passed).length,
    checks,
  };
}
