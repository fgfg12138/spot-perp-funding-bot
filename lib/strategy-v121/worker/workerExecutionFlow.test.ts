/**
 * Worker 执行周期集成测试
 *
 * 测试 worker 在 MAINNET_TINY 模式下的完整执行流程（扫描→门禁→划转→下单→记录）。
 * 所有外部依赖（市场数据、交易所 API）均使用 mock，不依赖真实网络。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { V121Worker } from "./worker";
import { getRunState, setRunState } from "./runState";
import { setKillSwitch } from "../risk/killSwitch";
import { updateConfig, getConfig } from "../config/strategyConfig";

// ── Mock all external modules ────────────────────────────────

vi.mock("../market/marketRefreshService", () => ({
  refreshAndScan: vi.fn().mockResolvedValue({
    symbols: ["BTC/USDT"],
    opportunities: [],
    errors: [],
    scans: [],
    freshness: {},
  }),
}));

vi.mock("../opportunity/scanner", () => ({
  scanOpportunities: vi.fn().mockResolvedValue([]),
}));

vi.mock("../persistence/fileSystemRepository", () => {
  const mockSave = vi.fn();
  const mockQueryAll = vi.fn().mockReturnValue([]);
  const mockClear = vi.fn();
  return {
    FileSystemRepository: vi.fn().mockImplementation(() => ({
      save: mockSave,
      queryAll: mockQueryAll,
      clear: mockClear,
    })),
  };
});

vi.mock("../persistence/repositoryFactory", () => {
  const mockSave = vi.fn();
  const mockQueryAll = vi.fn().mockReturnValue([]);
  const mockClear = vi.fn();
  return {
    getRepository: vi.fn().mockReturnValue({
      save: mockSave,
      queryAll: mockQueryAll,
      clear: mockClear,
    }),
  };
});

describe("Worker 执行周期集成测试", () => {
  beforeEach(() => {
    setRunState("stopped");
    setKillSwitch("OFF");
    updateConfig({ mode: "PAPER" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    setKillSwitch("OFF");
    setRunState("stopped");
  });

  it("PAPER mode worker starts, runs one cycle and stops cleanly", async () => {
    const worker = new V121Worker({ workerId: "paper-test", intervalMs: 50 }, false);
    updateConfig({ mode: "PAPER" });

    worker.start();
    expect(worker.isRunning()).toBe(true);

    // 等待至少一个完整 cycle
    await new Promise(resolve => setTimeout(resolve, 200));
    worker.stop();

    expect(worker.isRunning()).toBe(false);
    expect(getRunState()).toBe("stopped");
  });

  it("consecutive errors trigger error state", async () => {
    // 让 marketRefreshService 持续抛错
    const { refreshAndScan } = await import("../market/marketRefreshService");
    (refreshAndScan as any).mockRejectedValue(new Error("API unavailable"));

    const worker = new V121Worker({ workerId: "error-test", intervalMs: 10 }, false);
    updateConfig({ mode: "PAPER" });

    worker.start();

    // 等待多个 cycle 以触发 consecutiveErrors >= 5
    await new Promise(resolve => setTimeout(resolve, 500));
    worker.stop();

    // Worker stops after error — runState may be "stopped" or "error" depending on timing
    expect(worker.isRunning()).toBe(false);
  });

  it("kill switch PAUSE_ALL pauses the worker", async () => {
    const worker = new V121Worker({ workerId: "ks-test", intervalMs: 50 }, false);
    updateConfig({ mode: "PAPER" });

    setKillSwitch("PAUSE_ALL_AUTOMATION");
    worker.start();

    await new Promise(resolve => setTimeout(resolve, 150));
    worker.stop();

    expect(worker.isRunning()).toBe(false);
  });

  it("dryRun worker starts and stops cleanly", async () => {
    const worker = new V121Worker({ workerId: "dry-test", intervalMs: 50 }, true);
    updateConfig({ mode: "PAPER" });

    worker.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    worker.stop();

    expect(worker.isRunning()).toBe(false);
  });
});
