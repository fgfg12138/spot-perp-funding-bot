/**
 * 机会监控器 — 定时读取最新 scan，发现合格机会生成告警。
 *
 * 规则：同所 Binance/OKX、S/A 级、非小币、funding_8h >= 0.05%、通过硬过滤。
 * HTX 和小币/跨所不进入 MAINNET_TINY 候选。
 */
import { getRepository } from "../persistence/repositoryFactory";
import { getLatestScan } from "./opportunityStore";
import { isSmallCoin } from "../market/contractSpec";
import { getFundingThreshold8h } from "../config/fundingThresholdPolicy";

export interface OpportunityAlert {
  id: string;
  symbol: string;
  spotExchange: string;
  perpExchange: string;
  funding8h: number;
  entryBasis: number;
  expectedNetRate?: number;
  score: number;
  level: string;
  riskTags: string[];
  detectedAtUtc: number;
  latestScanId: string;
  snapshotHash: string;
  status: "new" | "acknowledged" | "expired" | "converted_to_intent";
  chineseMessage: string;
  thresholdSource?: "production" | "test_override";
  threshold8h?: number;
  isTestThreshold?: boolean;
}

export function checkForAlerts(): OpportunityAlert[] {
  const repo = getRepository();
  const scan = getLatestScan();
  if (!scan || !scan.opportunities?.length) return [];

  const alerts: OpportunityAlert[] = [];
  const now = Date.now();
  const { threshold, source } = getFundingThreshold8h("dry_run");

  for (const opp of scan.opportunities) {
    const spotEx = opp.path?.spotExchange ?? opp.spotExchange ?? "";
    const perpEx = opp.path?.perpExchange ?? opp.perpExchange ?? "";

    if (spotEx !== perpEx) continue;
    if (spotEx === "htx" || perpEx === "htx") continue;
    if (isSmallCoin(opp.symbol ?? opp.path?.symbol ?? "")) continue;

    const funding8h = opp.funding8h ?? 0;

    // 使用阈值策略
    if (funding8h < threshold) continue;

    // 生产阈值 + 未通过 → 跳过
    if (source === "production" && !opp.passed) continue;

    // 测试阈值下允许仅因 funding_too_low 被淘汰的机会
    if (source === "test_override" && !opp.passed) {
      const onlyFundingRejected = (opp.rejectReasons ?? []).every((r: any) => r.rule === "funding_too_low");
      if (!onlyFundingRejected) continue;
    }

    if (opp.level !== "S" && opp.level !== "A") continue;

    const isTest = source === "test_override";
    const alert: OpportunityAlert = {
      id: `alert-${now}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: opp.symbol ?? opp.path?.symbol ?? "",
      spotExchange: spotEx, perpExchange: perpEx,
      funding8h, entryBasis: opp.entryExecutableBasis ?? 0,
      score: opp.score ?? 0, level: opp.level ?? "C",
      riskTags: opp.warnings ?? [],
      detectedAtUtc: now,
      latestScanId: `scan-${scan.scannedAtUtc}`,
      snapshotHash: `${opp.symbol ?? "?"}-${spotEx}-${now}`,
      status: "new",
      thresholdSource: source, threshold8h: threshold, isTestThreshold: isTest,
      chineseMessage: isTest
        ? `[测试阈值] 发现 ${opp.symbol ?? "?"} ${spotEx} 机会，funding_8h=${(funding8h * 100).toFixed(3)}%（测试门槛 ${(threshold * 100).toFixed(3)}%），仅用于 dry-run 验证`
        : `发现 ${opp.symbol ?? "?"} ${spotEx} 机会，funding_8h=${(funding8h * 100).toFixed(3)}%，评分 ${opp.score ?? 0}，等级 ${opp.level ?? "?"}`,
    };
    alerts.push(alert);
    repo.save("opportunity_alerts", alert as any);
  }
  return alerts;
}

export function getActiveAlerts(): OpportunityAlert[] {
  const repo = getRepository();
  const all = repo.queryAll("opportunity_alerts") as any[];
  const now = Date.now();
  return all.filter(a => {
    if (a.status === "expired" || a.status === "converted_to_intent") return false;
    if (now - (a.detectedAtUtc ?? a.detected_at_utc ?? 0) > 3600_000) {
      a.status = "expired";
      try { repo.save("opportunity_alerts", a); } catch {}
      return false;
    }
    return true;
  }) as OpportunityAlert[];
}

export function acknowledgeAlert(alertId: string): boolean {
  const repo = getRepository();
  const all = repo.queryAll("opportunity_alerts") as any[];
  const alert = all.find((a: any) => a.id === alertId);
  if (!alert) return false;
  alert.status = "acknowledged";
  repo.save("opportunity_alerts", alert);
  return true;
}
