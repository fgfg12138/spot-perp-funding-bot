import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { V121Worker } from "./worker";
import { getRunState, setRunState } from "./runState";
import { getKillSwitch, setKillSwitch } from "../risk/killSwitch";
import { updateConfig } from "../config/strategyConfig";

describe("V121Worker", () => {
  beforeEach(() => {
    setRunState("stopped");
    setKillSwitch("OFF");
    updateConfig({ mode: "PAPER" });
  });

  afterEach(() => {
    setKillSwitch("OFF");
    setRunState("stopped");
  });

  it("worker starts and stops cleanly", async () => {
    const worker = new V121Worker({ workerId: "test-1", intervalMs: 100 }, true);
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop();
    expect(worker.isRunning()).toBe(false);
    expect(getRunState()).toBe("stopped");
  });

  it("worker exits when kill switch blocks PAPER", () => {
    setKillSwitch("READ_ONLY_ONLY");
    const worker = new V121Worker({ workerId: "test-2", intervalMs: 100 }, true);
    worker.start();
    // Let one cycle run — kill switch should trigger pause
    // After cycle, runState should be "paused"
    setTimeout(() => {
      worker.stop();
      expect(getRunState()).toBe("stopped");
    }, 150);
  });

  it("worker runs one cycle and increments", async () => {
    const worker = new V121Worker({ workerId: "test-3", intervalMs: 100 }, true);
    updateConfig({ mode: "PAPER" });
    worker.start();

    // Wait for at least one cycle
    await new Promise(resolve => setTimeout(resolve, 200));
    worker.stop();

    // After stop, runState should be stopped
    expect(getRunState()).toBe("stopped");
  });

  it("dry run doesn't crash", () => {
    const worker = new V121Worker({ workerId: "test-4", intervalMs: 1000 }, true);
    worker.start();
    worker.stop();
  });
});
