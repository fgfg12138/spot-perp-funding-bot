import { describe, expect, it, beforeEach } from "vitest";
import { getFundingThreshold8h, PRODUCTION_MIN_FUNDING_8H, isTestThresholdAlert } from "./fundingThresholdPolicy";

describe("fundingThresholdPolicy", () => {
  beforeEach(() => {
    delete process.env.V121_TEST_FUNDING_THRESHOLD_ENABLED;
    delete process.env.V121_TEST_FUNDING_THRESHOLD_8H;
  });

  it("默认返回生产阈值 0.05%", () => {
    const r = getFundingThreshold8h("dry_run");
    expect(r.threshold).toBe(0.0005);
    expect(r.source).toBe("production");
  });

  it("actual_execution 永远返回生产阈值", () => {
    process.env.V121_TEST_FUNDING_THRESHOLD_ENABLED = "true";
    process.env.V121_TEST_FUNDING_THRESHOLD_8H = "0.0001";
    const r = getFundingThreshold8h("actual_execution");
    expect(r.threshold).toBe(0.0005);
    expect(r.source).toBe("production");
  });

  it("dry_run 在测试开启时返回测试阈值", () => {
    process.env.V121_TEST_FUNDING_THRESHOLD_ENABLED = "true";
    process.env.V121_TEST_FUNDING_THRESHOLD_8H = "0.0001";
    const r = getFundingThreshold8h("dry_run");
    expect(r.threshold).toBe(0.0001);
    expect(r.source).toBe("test_override");
    expect(r.warning).toContain("测试阈值");
  });

  it("非法测试阈值回退生产", () => {
    process.env.V121_TEST_FUNDING_THRESHOLD_ENABLED = "true";
    process.env.V121_TEST_FUNDING_THRESHOLD_8H = "0.00001"; // 低于 0.005%
    const r = getFundingThreshold8h("dry_run");
    expect(r.threshold).toBe(0.0005);
    expect(r.source).toBe("production");
  });

  it("isTestThresholdAlert 检测测试阈值告警", () => {
    expect(isTestThresholdAlert({ thresholdSource: "test_override" })).toBe(true);
    expect(isTestThresholdAlert({ isTestThreshold: true })).toBe(true);
    expect(isTestThresholdAlert({})).toBe(false);
  });
});
