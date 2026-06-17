import { describe, expect, it, beforeEach } from "vitest";
import { isPersistenceReadyForTiny, getPersistenceMode, setPersistenceMode } from "./persistenceMode";

describe("persistenceMode", () => {
  beforeEach(() => { setPersistenceMode("jsonl-dev-only"); });

  it("默认为 jsonl-dev-only", () => {
    expect(getPersistenceMode()).toBe("jsonl-dev-only");
  });

  it("jsonl-dev-only 不允许 MAINNET_TINY", () => {
    expect(isPersistenceReadyForTiny()).toBe(false);
  });

  it("sqlite-active 允许 MAINNET_TINY", () => {
    setPersistenceMode("sqlite-active");
    expect(isPersistenceReadyForTiny()).toBe(true);
  });
});
