import { describe, expect, it, vi, beforeEach } from "vitest";
import { emitHeartbeat, readHeartbeats } from "./heartbeat";

vi.mock("../persistence/repositoryFactory", () => {
  const sv = vi.fn();
  const qa = vi.fn().mockReturnValue([]);
  return {
    getRepository: vi.fn().mockReturnValue({ save: sv, queryAll: qa }),
  };
});

vi.mock("./runState", () => ({
  getHeartbeat: vi.fn().mockReturnValue({
    workerId: "test-worker",
    state: "running",
    mode: "MAINNET_TINY",
    lastCycleAtUtc: 1719000000000,
    cycleCount: 5,
    lastError: undefined,
  }),
}));

async function getRepo() {
  const { getRepository } = await import("../persistence/repositoryFactory");
  return getRepository();
}

describe("emitHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves with snake_case fields matching SQLite schema", async () => {
    emitHeartbeat("test-worker", "MAINNET_TINY");
    const repo = await getRepo();
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][1];
    expect(saved.worker_id).toBe("test-worker");
    expect(saved.last_cycle_at_utc).toBe(1719000000000);
    expect(saved.cycle_count).toBe(5);
    expect(saved.id).toBe("test-worker");
  });

  it("camelCase fields not passed (compatibility)", async () => {
    emitHeartbeat("test-worker", "MAINNET_TINY");
    const repo = await getRepo();
    const saved = repo.save.mock.calls[0][1];
    expect(saved.workerId).toBeUndefined();
    expect(saved.lastCycleAtUtc).toBeUndefined();
  });
});

describe("readHeartbeats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts snake_case rows to WorkerHeartbeat", async () => {
    const repo = await getRepo();
    repo.queryAll.mockReturnValue([{
      id: "test-worker",
      worker_id: "test-worker",
      state: "running",
      mode: "MAINNET_TINY",
      last_cycle_at_utc: 1719000000000,
      cycle_count: 5,
      last_error: null,
    }]);
    const results = readHeartbeats();
    expect(results).toHaveLength(1);
    expect(results[0].workerId).toBe("test-worker");
    expect(results[0].lastCycleAtUtc).toBe(1719000000000);
    expect(results[0].cycleCount).toBe(5);
  });

  it("falls back to camelCase fields if snake_case missing", async () => {
    const repo = await getRepo();
    repo.queryAll.mockReturnValue([{
      id: "test-worker",
      workerId: "test-worker",
      state: "running",
      mode: "MAINNET_TINY",
      lastCycleAtUtc: 1719000000000,
      cycleCount: 5,
    }]);
    const results = readHeartbeats();
    expect(results[0].workerId).toBe("test-worker");
    expect(results[0].cycleCount).toBe(5);
  });

  it("handles empty result set", async () => {
    const repo = await getRepo();
    repo.queryAll.mockReturnValue([]);
    expect(readHeartbeats()).toHaveLength(0);
  });
});
