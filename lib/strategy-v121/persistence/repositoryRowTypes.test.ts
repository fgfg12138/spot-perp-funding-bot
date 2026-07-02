import { describe, it, expect } from "vitest";
import {
  readTimestamp,
  readString,
  readNumber,
  readBoolean,
  readJson,
} from "./repositoryRowTypes";

describe("readTimestamp", () => {
  it("按 key 优先级返回第一个可用数字", () => {
    const row = { a: null, scanned_at_utc: "1680000000000", scannedAtUtc: 1690000000000 };
    expect(readTimestamp(row, ["a", "scanned_at_utc", "scannedAtUtc"])).toBe(1680000000000);
  });

  it("跳过非数字并继续后续 key", () => {
    const row = { a: "not-a-number", b: undefined, scannedAtUtc: 1690000000000 };
    expect(readTimestamp(row, ["a", "b", "scannedAtUtc"])).toBe(1690000000000);
  });

  it("全部缺失返回 0", () => {
    expect(readTimestamp({}, ["a", "b"])).toBe(0);
  });

  it("从 Unix 秒数字段读取时间戳", () => {
    const row = { scanned_at_utc: 1680000000 };
    expect(readTimestamp(row, ["scanned_at_utc"])).toBe(1680000000);
  });

  it("从 ISO 字符串字段读取时间戳", () => {
    const row = { createdAtUtc: "1690000000000" };
    expect(readTimestamp(row, ["createdAtUtc"])).toBe(1690000000000);
  });
});

describe("readString", () => {
  it("返回第一个可用字符串", () => {
    const row = { a: null, data_source: "binance", dataSource: "okx" };
    expect(readString(row, ["a", "data_source", "dataSource"])).toBe("binance");
  });

  it("全部缺失返回 fallback", () => {
    expect(readString({}, ["a", "b"], "fallback")).toBe("fallback");
  });

  it("数值会被转成字符串", () => {
    expect(readString({ n: 42 }, ["n"])).toBe("42");
  });
});

describe("readNumber", () => {
  it("返回第一个可用数字", () => {
    const row = { a: "x", total_paths: "5", passed_count: 3 };
    expect(readNumber(row, ["a", "total_paths", "passed_count"])).toBe(5);
  });

  it("解析失败时 fallback", () => {
    expect(readNumber({ a: "abc" }, ["a"], -1)).toBe(-1);
  });

  it("全部缺失返回默认 0", () => {
    expect(readNumber({}, ["a"])).toBe(0);
  });
});

describe("readBoolean", () => {
  it("识别 boolean 输入", () => {
    expect(readBoolean({ v: true }, ["v"])).toBe(true);
    expect(readBoolean({ v: false }, ["v"])).toBe(false);
  });

  it("识别 number 输入", () => {
    expect(readBoolean({ v: 1 }, ["v"])).toBe(true);
    expect(readBoolean({ v: 0 }, ["v"])).toBe(false);
    expect(readBoolean({ v: 2 }, ["v"])).toBe(false);
  });

  it("识别 string 输入", () => {
    expect(readBoolean({ v: "true" }, ["v"])).toBe(true);
    expect(readBoolean({ v: "1" }, ["v"])).toBe(true);
    expect(readBoolean({ v: "false" }, ["v"])).toBe(false);
    expect(readBoolean({ v: "0" }, ["v"])).toBe(false);
  });

  it("全部缺失返回 fallback", () => {
    expect(readBoolean({}, ["v"], true)).toBe(true);
  });

  it("true/false 字符串读取", () => {
    expect(readBoolean({ v: "true" }, ["v"])).toBe(true);
    expect(readBoolean({ v: "false" }, ["v"])).toBe(false);
  });

  it("缺省字段返回 false", () => {
    expect(readBoolean({}, ["nonexistent"])).toBe(false);
  });
});

describe("readJson", () => {
  it("解析字符串 JSON", () => {
    const row = { data_json: '{"foo":1}' };
    expect(readJson<Record<string, number>>(row, ["data_json"], {})).toEqual({ foo: 1 });
  });

  it("直接返回对象", () => {
    const row = { data: { foo: 2 } };
    expect(readJson<Record<string, number>>(row, ["data"], {})).toEqual({ foo: 2 });
  });

  it("按优先级读取", () => {
    const row = { a: null, b: '{"k":2}', c: '{"k":3}' };
    expect(readJson<Record<string, number>>(row, ["a", "b", "c"], {})).toEqual({ k: 2 });
  });

  it("解析失败返回 fallback", () => {
    expect(readJson<unknown[]>({ v: "not-json" }, ["v"], [])).toEqual([]);
  });

  it("全部缺失返回 fallback", () => {
    expect(readJson<unknown[]>({}, ["v"], [])).toEqual([]);
  });

  it("readJson<T> 返回正确的泛型类型", () => {
    const row = { data_json: '{"name":"test","value":42}' };
    const result = readJson<{ name: string; value: number }>(row, ["data_json"], { name: "", value: 0 });
    expect(result.name).toBe("test");
    expect(result.value).toBe(42);
  });

  it("readString 按优先级返回第一个可用值", () => {
    const row = { a: null, b: undefined, c: "first", d: "second" };
    expect(readString(row, ["a", "b", "c", "d"])).toBe("first");
  });

  it("readString 全部缺失返回默认 fallback", () => {
    expect(readString({ missing: "x" }, ["a", "b"], "fallback-val")).toBe("fallback-val");
  });
});
