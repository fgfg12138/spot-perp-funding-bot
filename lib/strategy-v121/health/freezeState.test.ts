import { describe, expect, it } from "vitest";
import { evaluateFreezeState, canOpenPosition } from "./freezeState";

describe("evaluateFreezeState", () => {
  it("no freeze when everything is healthy", () => {
    const r = evaluateFreezeState({
      wsOk: true, restOk: true, timeSyncMs: 100, wsLatencyMs: 500,
      orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 10000,
    });
    expect(r.level).toBe("none");
    expect(canOpenPosition(r)).toBe(true);
  });

  it("level1 when WS is down", () => {
    const r = evaluateFreezeState({
      wsOk: false, restOk: true, timeSyncMs: 100, wsLatencyMs: 0,
      orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 10000,
    });
    expect(r.level).toBe("level1");
    expect(r.prohibitedActions).toContain("open_new");
    expect(r.allowedActions).toContain("hard_stop_loss");
  });

  it("level2 when REST is down", () => {
    const r = evaluateFreezeState({
      wsOk: false, restOk: false, timeSyncMs: 100, wsLatencyMs: 0,
      orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 10000,
    });
    expect(r.level).toBe("level2");
    expect(r.allowedActions).toContain("alert_human");
  });

  it("level2 when order status unknown", () => {
    const r = evaluateFreezeState({
      wsOk: true, restOk: true, timeSyncMs: 100, wsLatencyMs: 500,
      orderStatusUnknown: true, dataFreshMs: 1000, maxDataAgeMs: 10000,
    });
    expect(r.level).toBe("level2");
  });

  it("level2 when time sync > 1000ms", () => {
    const r = evaluateFreezeState({
      wsOk: true, restOk: true, timeSyncMs: 1500, wsLatencyMs: 500,
      orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 10000,
    });
    expect(r.level).toBe("level2");
  });
});
