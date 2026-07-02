import { describe, expect, it } from "vitest";
import {
  createExchangeError,
  isExchangeError,
  getErrorCode,
  setErrorCode,
} from "./exchangeError";

describe("exchangeError", () => {
  it("createExchangeError 设置 code 和 raw", () => {
    const raw = { body: "test" };
    const err = createExchangeError("something failed", -2015, raw);
    expect(err.message).toBe("something failed");
    expect(err.code).toBe(-2015);
    expect(err.raw).toBe(raw);
  });

  it("isExchangeError 正确判断", () => {
    const exchangeErr = createExchangeError("exchange fail", -2015);
    expect(isExchangeError(exchangeErr)).toBe(true);

    const plainErr = new Error("plain fail");
    expect(isExchangeError(plainErr)).toBe(false);

    expect(isExchangeError(null)).toBe(false);
    expect(isExchangeError("string")).toBe(false);
  });

  it("getErrorCode 返回 code 或 undefined", () => {
    const exchangeErr = createExchangeError("exchange fail", -2015);
    expect(getErrorCode(exchangeErr)).toBe(-2015);

    const plainErr = new Error("plain fail");
    expect(getErrorCode(plainErr)).toBeUndefined();

    expect(getErrorCode(undefined)).toBeUndefined();
  });

  it("setErrorCode 修改已有 Error", () => {
    const err = new Error("original message");
    const exchangeErr = setErrorCode(err, -2015);
    expect(exchangeErr.message).toBe("original message");
    expect(exchangeErr.code).toBe(-2015);
    expect(err).toBe(exchangeErr);
  });

  it("createExchangeError 带 UNKNOWN_ERROR 和 code + raw", () => {
    const raw = { sys: "error_detail" };
    const err = createExchangeError("UNKNOWN_ERROR", { code: "SYS_ERR" }, raw);
    expect(err.message).toBe("UNKNOWN_ERROR");
    expect(err.code).toEqual({ code: "SYS_ERR" });
    expect(err.raw).toBe(raw);
  });

  it("isExchangeError 对 null/undefined/string 返回 false", () => {
    expect(isExchangeError(null)).toBe(false);
    expect(isExchangeError(undefined)).toBe(false);
    expect(isExchangeError("some string")).toBe(false);
  });

  it("getErrorCode 从 ExchangeError 返回正确 code", () => {
    const err = createExchangeError("err", 1001);
    expect(getErrorCode(err)).toBe(1001);
  });

  it("getErrorCode 从普通 Error 返回 undefined", () => {
    const err = new Error("plain");
    expect(getErrorCode(err)).toBeUndefined();
  });

  it("setErrorCode 修改已有 Error 的 code", () => {
    const err = new Error("target me");
    const updated = setErrorCode(err, "TARGET_CODE");
    expect(updated.code).toBe("TARGET_CODE");
    expect(updated.message).toBe("target me");
    expect(err).toBe(updated);
  });
});
