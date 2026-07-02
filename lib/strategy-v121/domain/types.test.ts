import { describe, it, expect } from "vitest";
import { isExchangeId } from "./types";

describe("isExchangeId", () => {
  it('recognizes "binance" as a valid ExchangeId', () => {
    expect(isExchangeId("binance")).toBe(true);
  });

  it('recognizes "okx" as a valid ExchangeId', () => {
    expect(isExchangeId("okx")).toBe(true);
  });

  it('rejects "htx" because HTX has been removed from ALLOWED_EXCHANGES', () => {
    expect(isExchangeId("htx")).toBe(false);
  });

  it('rejects "binance_test"', () => {
    expect(isExchangeId("binance_test")).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isExchangeId("")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isExchangeId(undefined)).toBe(false);
  });

  it("rejects numbers", () => {
    expect(isExchangeId(42)).toBe(false);
  });

  it("rejects objects", () => {
    expect(isExchangeId({})).toBe(false);
  });
});
