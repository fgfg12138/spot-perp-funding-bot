import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  writeAuditLog,
  auditInfo,
  auditWarn,
  auditError,
  auditSecurity,
  queryAuditLogs,
  getRecentAuditLogs,
  getErrorAuditLogs,
  getSecurityAuditLogs,
  setAuditEnabled,
  isAuditEnabled,
  AuditCategory,
  type AuditEntry,
} from "./auditLogger";
import { getRepository } from "../persistence/repositoryFactory";

// mock repository
vi.mock("../persistence/repositoryFactory", () => ({
  getRepository: vi.fn(),
}));

describe("auditLogger", () => {
  let mockSave: ReturnType<typeof vi.fn>;
  let mockQueryAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAuditEnabled(true);
    mockSave = vi.fn();
    mockQueryAll = vi.fn().mockReturnValue([]);
    (getRepository as ReturnType<typeof vi.fn>).mockReturnValue({
      save: mockSave,
      queryAll: mockQueryAll,
    });
  });

  describe("writeAuditLog", () => {
    it("写入日志到 repository", () => {
      const id = writeAuditLog({
        level: "INFO",
        category: "test",
        message: "测试消息",
      });
      expect(id).toBeTruthy();
      expect(mockSave).toHaveBeenCalledTimes(1);
      const saved = mockSave.mock.calls[0];
      expect(saved[0]).toBe("audit_log");
      expect(saved[1].level).toBe("INFO");
      expect(saved[1].category).toBe("test");
      expect(saved[1].message).toBe("测试消息");
      expect(saved[1].id).toBe(id);
      expect(saved[1].createdAtUtc).toBeGreaterThan(0);
    });

    it("auditEnabled=false 时跳过写入", () => {
      setAuditEnabled(false);
      const id = writeAuditLog({ level: "INFO", category: "test", message: "跳过" });
      expect(id).toBe("");
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("repository 异常时不抛异常", () => {
      mockSave.mockImplementation(() => { throw new Error("db error"); });
      expect(() => {
        writeAuditLog({ level: "ERROR", category: "test", message: "应该静默处理" });
      }).not.toThrow();
    });
  });

  describe("便捷方法", () => {
    it("auditInfo", () => {
      const id = auditInfo(AuditCategory.WORKER_LIFECYCLE, "Worker 启动", { workerId: "w1" });
      expect(id).toBeTruthy();
      expect(mockSave.mock.calls[0][1].level).toBe("INFO");
      expect(mockSave.mock.calls[0][1].workerId).toBe("w1");
    });

    it("auditWarn", () => {
      auditWarn(AuditCategory.MARKET_REFRESH, "数据延迟", { exchange: "binance", symbol: "BTCUSDT" });
      expect(mockSave.mock.calls[0][1].level).toBe("WARN");
      expect(mockSave.mock.calls[0][1].exchange).toBe("binance");
      expect(mockSave.mock.calls[0][1].symbol).toBe("BTCUSDT");
    });

    it("auditError 包含 error 详情", () => {
      const err = new Error("网络超时");
      auditError(AuditCategory.ENTRY, "入场失败", { error: err, exchange: "okx", durationMs: 5000 });
      const detail = JSON.parse(mockSave.mock.calls[0][1].detail);
      expect(detail.errorMessage).toBe("网络超时");
      expect(detail.errorStack).toBeTruthy();
      expect(mockSave.mock.calls[0][1].durationMs).toBe(5000);
    });

    it("auditSecurity", () => {
      auditSecurity("检测到疑似密钥泄露", { detail: { source: "scan_log" }, exchange: "binance" });
      expect(mockSave.mock.calls[0][1].level).toBe("SECURITY");
      const detail = JSON.parse(mockSave.mock.calls[0][1].detail);
      expect(detail.source).toBe("scan_log");
    });

    it("auditInfo 带 detail 对象", () => {
      auditInfo(AuditCategory.CONFIG, "配置更新", {
        detail: { key: "minFundingRate8h", old: 0.05, new: 0.08 },
      });
      const detail = JSON.parse(mockSave.mock.calls[0][1].detail);
      expect(detail.key).toBe("minFundingRate8h");
      expect(detail.old).toBe(0.05);
      expect(detail.new).toBe(0.08);
    });
  });

  describe("queryAuditLogs", () => {
    const sampleEntries: AuditEntry[] = [
      { id: "1", level: "INFO", category: "worker.lifecycle", message: "start", createdAtUtc: 1000, detail: undefined },
      { id: "2", level: "WARN", category: "market.refresh", message: "slow", createdAtUtc: 2000, exchange: "binance" },
      { id: "3", level: "ERROR", category: "entry", message: "fail", createdAtUtc: 3000, exchange: "okx", symbol: "BTCUSDT" },
      { id: "4", level: "ERROR", category: "entry", message: "fail2", createdAtUtc: 4000, exchange: "binance" },
      { id: "5", level: "SECURITY", category: "security", message: "leak", createdAtUtc: 5000 },
    ];

    beforeEach(() => {
      mockQueryAll.mockReturnValue(sampleEntries);
    });

    it("按 level 过滤", () => {
      const result = queryAuditLogs({ level: "ERROR" });
      expect(result).toHaveLength(2);
      result.forEach((e) => expect(e.level).toBe("ERROR"));
    });

    it("按 category 过滤", () => {
      const result = queryAuditLogs({ category: "market.refresh" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("按 exchange 过滤", () => {
      const result = queryAuditLogs({ exchange: "binance" });
      expect(result).toHaveLength(2);
    });

    it("按 symbol 过滤", () => {
      const result = queryAuditLogs({ symbol: "BTCUSDT" });
      expect(result).toHaveLength(1);
    });

    it("按时间范围过滤", () => {
      const result = queryAuditLogs({ sinceUtc: 2000, untilUtc: 4000 });
      // 2000, 3000, 4000 都落在范围内
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("按 limit 限制结果", () => {
      const result = queryAuditLogs({ limit: 2 });
      expect(result).toHaveLength(2);
    });

    it("倒序排序（最新的在前）", () => {
      const result = queryAuditLogs({});
      expect(result[0].createdAtUtc).toBeGreaterThanOrEqual(result[result.length - 1].createdAtUtc);
    });
  });

  describe("便捷查询", () => {
    beforeEach(() => {
      mockQueryAll.mockReturnValue([
        { id: "1", level: "ERROR", category: "entry", message: "fail", createdAtUtc: 3000 },
        { id: "2", level: "SECURITY", category: "security", message: "leak", createdAtUtc: 5000 },
      ] as AuditEntry[]);
    });

    it("getRecentAuditLogs 按时间倒序返回最近的 N 条", () => {
      const result = getRecentAuditLogs(10);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("getErrorAuditLogs 只返回 ERROR", () => {
      const result = getErrorAuditLogs(10);
      result.forEach((e) => expect(e.level).toBe("ERROR"));
    });

    it("getSecurityAuditLogs 只返回 SECURITY", () => {
      const result = getSecurityAuditLogs(10);
      result.forEach((e) => expect(e.level).toBe("SECURITY"));
    });
  });

  describe("setAuditEnabled / isAuditEnabled", () => {
    it("默认启用", () => {
      expect(isAuditEnabled()).toBe(true);
    });

    it("可以禁用和恢复", () => {
      setAuditEnabled(false);
      expect(isAuditEnabled()).toBe(false);
      setAuditEnabled(true);
      expect(isAuditEnabled()).toBe(true);
    });
  });
});
