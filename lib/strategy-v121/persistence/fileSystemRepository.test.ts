import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { FileSystemRepository } from "./fileSystemRepository";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("FileSystemRepository", () => {
  let repo: FileSystemRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v121-test-"));
    repo = new FileSystemRepository(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the base directory if missing", () => {
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it("save and queryAll round-trip", () => {
    repo.save("opportunity_records", { id: "1", symbol: "BTC/USDT", score: 85 });
    repo.save("opportunity_records", { id: "2", symbol: "ETH/USDT", score: 72 });
    const all = repo.queryAll("opportunity_records");
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("1");
    expect(all[1].id).toBe("2");
  });

  it("saveAll writes multiple records", () => {
    repo.saveAll("entry_executions", [
      { id: "a", batch_no: 1 }, { id: "b", batch_no: 2 },
    ]);
    expect(repo.count("entry_executions")).toBe(2);
  });

  it("query with filter", () => {
    repo.save("test", { a: 1 }); repo.save("test", { a: 2 }); repo.save("test", { a: 3 });
    const filtered = repo.query("test", r => (r.a as number) > 1);
    expect(filtered).toHaveLength(2);
  });

  it("latest returns last record", () => {
    repo.save("position_snapshots", { ts: 1 }); repo.save("position_snapshots", { ts: 2 });
    expect(repo.latest("position_snapshots")?.ts).toBe(2);
  });

  it("latest returns undefined for empty table", () => {
    expect(repo.latest("nonexistent")).toBeUndefined();
  });

  it("count returns correct count", () => {
    expect(repo.count("empty")).toBe(0);
    repo.save("empty", { x: 1 });
    expect(repo.count("empty")).toBe(1);
  });

  it("clear removes all data", () => {
    repo.save("temp", { a: 1 });
    repo.clear("temp");
    expect(repo.count("temp")).toBe(0);
  });

  it("listTables returns table names", () => {
    repo.save("opportunity_records", { id: "1" });
    repo.save("entry_decisions", { id: "2" });
    const tables = repo.listTables();
    expect(tables).toContain("opportunity_records");
    expect(tables).toContain("entry_decisions");
  });

  it("writes 7 core tables and reads back", () => {
    const tables = [
      "opportunity_records", "entry_decisions", "entry_executions",
      "position_snapshots", "funding_settlements",
      "exit_executions", "final_reviews",
    ];
    for (const t of tables) {
      repo.save(t, { table_name: t, written_at: Date.now() });
      expect(repo.count(t)).toBeGreaterThanOrEqual(1);
    }
    expect(repo.listTables().length).toBeGreaterThanOrEqual(7);
  });

  it("deleteById removes a specific record", () => {
    repo.save("test_del", { id: "a", x: 1 });
    repo.save("test_del", { id: "b", x: 2 });
    repo.save("test_del", { id: "c", x: 3 });
    expect(repo.count("test_del")).toBe(3);
    repo.deleteById("test_del", "b");
    expect(repo.count("test_del")).toBe(2);
    expect(repo.query("test_del", r => r.id === "b")).toHaveLength(0);
  });

  it("deleteById is no-op for missing id", () => {
    repo.save("test_del2", { id: "a", x: 1 });
    repo.deleteById("test_del2", "nonexistent");
    expect(repo.count("test_del2")).toBe(1);
  });

  it("queryAll skips corrupted lines and logs warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = path.join(tmpDir, "corrupt.jsonl");
    fs.writeFileSync(filePath, '{"id":"1","x":1}\nnot-valid-json\n{"id":"2","x":2}\n', "utf-8");
    const all = repo.queryAll("corrupt");
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("1");
    expect(all[1].id).toBe("2");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("[fileSystemRepository.queryAll]");
    warnSpy.mockRestore();
  });

  it("deleteById is no-op for missing table", () => {
    expect(() => repo.deleteById("nonexistent_table", "any")).not.toThrow();
  });
});
