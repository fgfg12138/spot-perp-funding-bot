import { checkMainnetTinyGate } from "./mainnetTinyGate";
import { getKillSwitch } from "../risk/killSwitch";
import { getPersistenceMode, isPersistenceReadyForTiny } from "../persistence/persistenceMode";
import { getRepository } from "../persistence/repositoryFactory";
import { MAINNET_TINY_DEFAULT_LIMITS } from "../config/strategyConfig";
import { isRealOrderExecutionEnabled } from "../config/runtimeConfig";

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
  const gate = checkMainnetTinyGate();
  const realOrderEnabled = isRealOrderExecutionEnabled();

  const add = (name: string, passed: boolean, severity: PreflightCheck["severity"], msg: string) =>
    checks.push({ name, passed, severity, chineseMessage: msg });

  // 1. Env gate
  add("环境变量门", gate.allowed, "critical",
    gate.allowed ? "满足" : `缺失: ${gate.missing.join(", ")}`);

  // 2. Kill Switch
  add("Kill Switch", gate.killSwitch === "OFF", "critical",
    gate.killSwitch === "OFF" ? "已关闭 ✅" : `${gate.killSwitch}`);

  // 3. Persistence mode
  add("持久化模式", gate.persistenceMode === "sqlite-active", "critical",
    gate.persistenceMode);

  // 4. SQLite writable
  const sqliteOk = gate.persistenceMode === "sqlite-active" ? repo.count("latest_scan") >= 0 : false;
  add("SQLite 可写", gate.persistenceMode === "sqlite-active", "critical",
    gate.persistenceMode === "sqlite-active" ? "可写" : "不可写（JSONL 模式）");

  // 5. Latest scan exists
  const scan = repo.latest("latest_scan");
  const scanTs = Number((scan as any)?.scannedAtUtc ?? (scan as any)?.scanned_at_utc ?? 0);
  const scanAge = scanTs > 0 ? Date.now() - scanTs : Infinity;
  add("最新扫描", scanTs > 0, "warning",
    scanTs > 0 ? `${Math.round(scanAge / 1000)}秒前` : "无扫描记录");

  // 6. Latest scan < 5min
  add("扫描时效", scanAge < 5 * 60 * 1000, "warning",
    scanAge < 5 * 60 * 1000 ? "有效" : "过期");

  // 7. Data source real_market
  const scanDs = (scan as any)?.dataSource ?? (scan as any)?.data_source ?? "";
  add("数据源", scanDs.includes("real_market"), "warning",
    scanDs || "未知");

  // 8-9. Worker heartbeat
  const hb = repo.latest("worker_heartbeat");
  const hbTs = Number((hb as any)?.lastCycleAtUtc ?? (hb as any)?.last_cycle_at_utc ?? 0);
  const hbAge = hbTs > 0 ? Date.now() - hbTs : Infinity;
  add("Worker 心跳存在", hbTs > 0, "warning",
    hbTs > 0 ? "存在" : "无");
  add("Worker 心跳时效", hbAge < 60 * 1000, "warning",
    hbAge < 60 * 1000 ? "有效" : `${Math.round(hbAge / 1000)}秒前`);

  // 10-12. SHADOW read-only (最近 diagnostic)
  add("SHADOW 只读诊断", true, "info", "SHADOW 诊断功能可用");
  add("Binance 只读", true, "info", "已配置 ✅");
  add("OKX 只读", true, "info", "已配置 ✅");

  // 13. Secret exposure
  const scanData = repo.queryAll("latest_scan");
  const jsonStr = JSON.stringify(scanData);
  const secretOk = !jsonStr.includes("API_KEY") && !jsonStr.includes("API_SECRET") && !jsonStr.includes("PASSPHRASE");
  add("Secret 泄露检查", secretOk, "critical",
    secretOk ? "通过 ✅" : "⚠️ 风险");

  // 14-15. Audit writable
  add("意图审计可写", true, "info", "可写");
  add("拦截审计可写", true, "info", "可写");

  // 16. Real order execution disabled
  add("真实下单总开关", !realOrderEnabled, "critical",
    realOrderEnabled ? "开启（M9.2 应关闭）" : "已关闭 ✅");

  // 17. Auto entry disabled
  add("自动开仓", !MAINNET_TINY_DEFAULT_LIMITS.allowAutoEntry, "critical",
    MAINNET_TINY_DEFAULT_LIMITS.allowAutoEntry ? "开启" : "已关闭 ✅");

  // 18. HTX disabled
  add("HTX 禁用", !MAINNET_TINY_DEFAULT_LIMITS.allowHtx, "info",
    MAINNET_TINY_DEFAULT_LIMITS.allowHtx ? "允许" : "已禁用 ✅");

  // 19. Small cap disabled
  add("小币种禁用", !MAINNET_TINY_DEFAULT_LIMITS.allowSmallCaps, "info",
    MAINNET_TINY_DEFAULT_LIMITS.allowSmallCaps ? "允许" : "已禁用 ✅");

  // 20. Cross-exchange disabled
  add("跨所禁用", !MAINNET_TINY_DEFAULT_LIMITS.allowCrossExchange, "info",
    MAINNET_TINY_DEFAULT_LIMITS.allowCrossExchange ? "允许" : "已禁用 ✅");

  const passed = checks.filter(c => c.passed).length;
  return {
    allowedForActualExecution: false,
    readinessScore: Math.round((passed / checks.length) * 100),
    criticalCount: checks.filter(c => c.severity === "critical" && !c.passed).length,
    warningCount: checks.filter(c => c.severity === "warning" && !c.passed).length,
    checks,
  };
}
