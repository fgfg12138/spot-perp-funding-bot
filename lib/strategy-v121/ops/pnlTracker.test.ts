import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  capturePnlSnapshot,
  queryPnlSnapshots,
  getLatestPnl,
  getLossPositions,
  getCriticalLossPositions,
  type PnlInput,
  type PnlSnapshot,
} from "./pnlTracker";
import { getRepository } from "../persistence/repositoryFactory";

vi.mock("../persistence/repositoryFactory", () => ({
  getRepository: vi.fn(),
}));

function makeInput(overrides: Partial<PnlInput> = {}): PnlInput {
  return {
    positionId: "pos-1",
    exchange: "binance",
    symbol: "BTCUSDT",
    spotNotional: 10000,
    perpNotional: 10000,
    spotEntryPrice: 50000,
    perpEntryPrice: 50000,
    spotCurrentPrice: 51000,
    perpCurrentPrice: 49500,
    cumulativeFundingUsdt: 50,
    realizedPnl: 0,
    openedAtUtc: 1000000,
    state: "OPEN",
    ...overrides,
  };
}

describe("pnlTracker", () => {
  let mockSave: ReturnType<typeof vi.fn>;
  let mockQueryAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSave = vi.fn();
    mockQueryAll = vi.fn().mockReturnValue([]);
    (getRepository as ReturnType<typeof vi.fn>).mockReturnValue({
      save: mockSave,
      queryAll: mockQueryAll,
    });
  });

  describe("capturePnlSnapshot", () => {
    it("计算正确的 PNL 值", () => {
      const input = makeInput();
      const result = capturePnlSnapshot(input);

      // Spot: (51000 - 50000) / 50000 * 10000 = 200
      // Perp: (50000 - 49500) / 50000 * 10000 = 100
      // unrealized: 200 + 100 = 300
      expect(result.unrealizedPnl).toBe(300);
      expect(result.realizedPnl).toBe(0);
      expect(result.totalPnl).toBe(300);

      // totalMargin = (10000 + 10000) / 2 = 10000
      // return = 300 / 10000 * 100 = 3%
      expect(result.returnPercent).toBe(3);
      expect(result.pnlLevel).toBe("profit");
    });

    it("空头方向：perp 价格下跌产生收益", () => {
      // Perp 从 50000 跌到 48000 → 空头盈利
      const input = makeInput({ perpCurrentPrice: 48000 });
      const result = capturePnlSnapshot(input);

      // Spot: (51000 - 50000) / 50000 * 10000 = 200
      // Perp: (50000 - 48000) / 50000 * 10000 = 400
      expect(result.unrealizedPnl).toBe(600);
    });

    it("亏损情况", () => {
      // Spot 跌、Perp 涨 → 双向亏损
      const input = makeInput({
        spotCurrentPrice: 49000,
        perpCurrentPrice: 51000,
      });
      const result = capturePnlSnapshot(input);

      // Spot: (49000 - 50000) / 50000 * 10000 = -200
      // Perp: (50000 - 51000) / 50000 * 10000 = -200
      expect(result.unrealizedPnl).toBe(-400);
      expect(result.pnlLevel).toBe("loss");
    });

    it("严重亏损触发 critical_loss", () => {
      // 亏损超过总保证金的 10%
      const input = makeInput({
        spotCurrentPrice: 40000,  // -20% on spot
        perpCurrentPrice: 60000,  // -20% on perp
      });
      const result = capturePnlSnapshot(input);

      // Spot: (40000 - 50000) / 50000 * 10000 = -2000
      // Perp: (50000 - 60000) / 50000 * 10000 = -2000
      // total = -4000, margin = 10000, ratio = -40%
      expect(result.totalPnl).toBe(-4000);
      expect(result.pnlLevel).toBe("critical_loss");
    });

    it("combined realized + unrealized", () => {
      const input = makeInput({ realizedPnl: 100 });
      const result = capturePnlSnapshot(input);

      // unrealized = 300, realized = 100
      expect(result.totalPnl).toBe(400);
    });

    it("保存到 repository", () => {
      capturePnlSnapshot(makeInput());
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockSave.mock.calls[0][0]).toBe("pnl_snapshots");
    });

    it("repository 异常时不抛异常", () => {
      mockSave.mockImplementation(() => { throw new Error("db error"); });
      expect(() => capturePnlSnapshot(makeInput())).not.toThrow();
    });

    it("breakeven 等级", () => {
      const input = makeInput({
        spotCurrentPrice: 50050,
        perpCurrentPrice: 49950,
      });
      const result = capturePnlSnapshot(input);
      // 很小的 PNL，应该 < margin * 1%
      expect(result.pnlLevel).toBe("breakeven");
    });

    it("entryPrice=0 时 PNL 为 0", () => {
      const input = makeInput({ spotEntryPrice: 0, perpEntryPrice: 0 });
      const result = capturePnlSnapshot(input);
      expect(result.unrealizedPnl).toBe(0);
    });
  });

  describe("queryPnlSnapshots", () => {
    const mockSnapshots: PnlSnapshot[] = [
      { id: "1", positionId: "pos-1", exchange: "binance", symbol: "BTCUSDT", spotNotional: 10000, perpNotional: 10000, spotEntryPrice: 50000, perpEntryPrice: 50000, spotCurrentPrice: 51000, perpCurrentPrice: 49500, cumulativeFundingUsdt: 50, unrealizedPnl: 300, realizedPnl: 0, totalPnl: 300, returnPercent: 3, openedAtUtc: 1000, snapshotAtUtc: 3000, state: "OPEN", pnlLevel: "profit" },
      { id: "2", positionId: "pos-2", exchange: "okx", symbol: "ETHUSDT", spotNotional: 5000, perpNotional: 5000, spotEntryPrice: 3000, perpEntryPrice: 3000, spotCurrentPrice: 2800, perpCurrentPrice: 3100, cumulativeFundingUsdt: 10, unrealizedPnl: -500, realizedPnl: 0, totalPnl: -500, returnPercent: -10, openedAtUtc: 2000, snapshotAtUtc: 4000, state: "OPEN", pnlLevel: "loss" },
    ];

    beforeEach(() => {
      mockQueryAll.mockReturnValue(mockSnapshots);
    });

    it("按 positionId 过滤", () => {
      const result = queryPnlSnapshots({ positionId: "pos-1" });
      expect(result).toHaveLength(1);
      expect(result[0].positionId).toBe("pos-1");
    });

    it("按 exchange 过滤", () => {
      const result = queryPnlSnapshots({ exchange: "okx" });
      expect(result).toHaveLength(1);
    });

    it("按 pnlLevel 过滤", () => {
      const result = queryPnlSnapshots({ pnlLevel: "loss" });
      expect(result).toHaveLength(1);
    });

    it("倒序排列", () => {
      const result = queryPnlSnapshots({});
      expect(result[0].snapshotAtUtc).toBeGreaterThanOrEqual(result[result.length - 1].snapshotAtUtc);
    });

    it("limit 限制", () => {
      const result = queryPnlSnapshots({ limit: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("getLatestPnl", () => {
    it("返回最新快照", () => {
      mockQueryAll.mockReturnValue([
        { id: "1", positionId: "pos-1", snapshotAtUtc: 2000, totalPnl: 100, pnlLevel: "profit" },
        { id: "2", positionId: "pos-1", snapshotAtUtc: 3000, totalPnl: 200, pnlLevel: "profit" },
      ] as PnlSnapshot[]);
      const result = getLatestPnl("pos-1");
      expect(result?.id).toBe("2");
      expect(result?.totalPnl).toBe(200);
    });

    it("不存在时返回 undefined", () => {
      const result = getLatestPnl("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getLossPositions / getCriticalLossPositions", () => {
    beforeEach(() => {
      mockQueryAll.mockReturnValue([
        { positionId: "p1", pnlLevel: "loss", totalPnl: -100, snapshotAtUtc: 3000 },
        { positionId: "p2", pnlLevel: "critical_loss", totalPnl: -2000, snapshotAtUtc: 4000 },
        { positionId: "p3", pnlLevel: "loss", totalPnl: -5, snapshotAtUtc: 5000 },
      ] as unknown as PnlSnapshot[]);
    });

    it("getLossPositions 过滤 minLossUsdt", () => {
      const result = getLossPositions(50);
      expect(result).toHaveLength(1);
      expect(result[0].positionId).toBe("p1");
    });

    it("getCriticalLossPositions", () => {
      const result = getCriticalLossPositions();
      expect(result).toHaveLength(1);
      expect(result[0].positionId).toBe("p2");
    });
  });
});
