/**
 * 资金费阈值策略 — 控制生产/测试阈值切换。
 *
 * 生产阈值：0.05%（不可修改）
 * 测试阈值：V121_TEST_FUNDING_THRESHOLD_8H 环境变量
 *
 * 测试阈值仅用于 READ_ONLY/PAPER/SHADOW/dry_run。
 * actual_execution 永远返回生产阈值。
 */

export type FundingThresholdContext =
  | "production"
  | "paper"
  | "shadow"
  | "dry_run"
  | "actual_execution";

export const PRODUCTION_MIN_FUNDING_8H = 0.0005; // 0.05% — 不可修改

export function getFundingThreshold8h(context: FundingThresholdContext): {
  threshold: number;
  source: "production" | "test_override";
  warning?: string;
} {
  if (context === "actual_execution" || context === "production") {
    return { threshold: PRODUCTION_MIN_FUNDING_8H, source: "production" };
  }

  const enabled = process.env.V121_TEST_FUNDING_THRESHOLD_ENABLED === "true";
  if (enabled) {
    const testVal = Number(process.env.V121_TEST_FUNDING_THRESHOLD_8H);
    if (testVal > 0 && testVal >= 0.00005 && testVal < PRODUCTION_MIN_FUNDING_8H) {
      return {
        threshold: testVal,
        source: "test_override",
        warning: `当前机会来自测试阈值 (${(testVal * 100).toFixed(3)}%)，仅用于 dry-run / Paper 验证，不代表正式套利达标。`,
      };
    }
  }

  return { threshold: PRODUCTION_MIN_FUNDING_8H, source: "production" };
}

export function isTestThresholdAlert(alert: any): boolean {
  return alert?.thresholdSource === "test_override" || alert?.isTestThreshold === true;
}
