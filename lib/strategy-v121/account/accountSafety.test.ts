import { describe, expect, it } from "vitest";
import { assertNotShadow, isActionBlockedInShadow } from "./accountSafety";

describe("accountSafety — SHADOW 模式安全门", () => {
  it("SHADOW 模式下禁止下单", () => {
    expect(() => assertNotShadow("SHADOW", "order")).toThrow("SHADOW");
  });

  it("SHADOW 模式下禁止撤单", () => {
    expect(() => assertNotShadow("SHADOW", "cancel")).toThrow("SHADOW");
  });

  it("SHADOW 模式下禁止改杠杆", () => {
    expect(() => assertNotShadow("SHADOW", "modify_leverage")).toThrow("SHADOW");
  });

  it("SHADOW 模式下禁止划转", () => {
    expect(() => assertNotShadow("SHADOW", "transfer")).toThrow("SHADOW");
  });

  it("非 SHADOW 模式不抛错", () => {
    expect(() => assertNotShadow("READ_ONLY", "order")).not.toThrow();
    expect(() => assertNotShadow("PAPER", "order")).not.toThrow();
  });

  it("isActionBlockedInShadow 阻止修改操作", () => {
    const blocked = ["order", "cancel", "modify_leverage", "transfer", "withdraw", "set_margin_mode"];
    for (const action of blocked) {
      const r = isActionBlockedInShadow("SHADOW", action);
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain("只允许读取");
    }
  });

  it("isActionBlockedInShadow 允许读取操作", () => {
    expect(isActionBlockedInShadow("SHADOW", "read_balance").blocked).toBe(false);
    expect(isActionBlockedInShadow("SHADOW", "read_position").blocked).toBe(false);
  });
});
