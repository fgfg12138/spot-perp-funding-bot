import { describe, expect, it } from "vitest";
import {
  createPaperExecution, startPrecheck, executeBatch,
  openPosition, startMonitoring, exitPosition, closePosition,
  reviewPosition, freezeExecution,
} from "./paperLifecycle";
import type { ArbitragePath } from "../domain/types";

const path: ArbitragePath = {
  symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance",
  isCrossExchange: false,
};

function spotFill(notional: number): { qty: number; avgPrice: number; notional: number } {
  return { qty: notional / 65000, avgPrice: 65000, notional };
}
function perpFill(notional: number): { qty: number; avgPrice: number; notional: number } {
  return { qty: notional / 65020, avgPrice: 65020, notional };
}

describe("PaperExecution lifecycle", () => {
  it("creates in IDLE state with a plan", () => {
    const ex = createPaperExecution("test-1", path, 3000);
    expect(ex.state).toBe("IDLE");
    expect(ex.plan.batches).toHaveLength(3);
    expect(ex.plan.totalNotional).toBe(3000);
  });

  it("transitions IDLE → PRECHECK", () => {
    const ex = startPrecheck(createPaperExecution("t1", path, 3000));
    expect(ex.state).toBe("PRECHECK");
  });

  it("normal 3-batch execution succeeds", () => {
    let ex = startPrecheck(createPaperExecution("t2", path, 3000));

    ex = executeBatch(ex, 1, spotFill(900), perpFill(900));
    expect(ex.state).toBe("BATCH_1_CONFIRMED");
    expect(ex.spotNotional).toBe(900);

    ex = executeBatch(ex, 2, spotFill(900), perpFill(900));
    expect(ex.state).toBe("BATCH_2_CONFIRMED");
    expect(ex.spotNotional).toBe(1800);

    ex = executeBatch(ex, 3, spotFill(1200), perpFill(1200));
    expect(ex.state).toBe("BATCH_3_CONFIRMED");
    expect(ex.spotNotional).toBe(3000);

    ex = openPosition(ex);
    expect(ex.state).toBe("OPEN");

    ex = startMonitoring(ex);
    expect(ex.state).toBe("MONITORING");

    ex = exitPosition(ex, "基差收敛");
    expect(ex.state).toBe("EXITING");

    ex = closePosition(ex);
    expect(ex.state).toBe("CLOSED");
  });

  it("batch fails when both fills are null", () => {
    let ex = startPrecheck(createPaperExecution("t3", path, 3000));
    ex = executeBatch(ex, 1, null, null);
    expect(ex.state).toBe("FAILED");
  });

  it("spot-only fill triggers short leg", () => {
    let ex = startPrecheck(createPaperExecution("t4", path, 3000));
    ex = executeBatch(ex, 1, spotFill(900), null);
    expect(ex.state).toBe("SHORT_LEG");
  });

  it("perp-only fill triggers short leg", () => {
    let ex = startPrecheck(createPaperExecution("t5", path, 3000));
    ex = executeBatch(ex, 1, null, perpFill(900));
    expect(ex.state).toBe("SHORT_LEG");
  });

  it("large deviation triggers SHORT_LEG", () => {
    let ex = startPrecheck(createPaperExecution("t6", path, 3000));
    // Fill very different notionals
    ex = executeBatch(ex, 1, spotFill(900), perpFill(700));
    // deviation = |900 - 700| / 900 = 22.2% > 1%
    expect(ex.state).toBe("SHORT_LEG");
  });

  it("freeze blocks further progression", () => {
    let ex = startPrecheck(createPaperExecution("t7", path, 3000));
    ex = freezeExecution(ex, "订单状态不明");
    expect(ex.state).toBe("FROZEN");
    // Can't open position from frozen
    ex = openPosition(ex);
    expect(ex.state).toBe("FROZEN");
  });

  it("cannot open position before all 3 batches confirmed", () => {
    let ex = startPrecheck(createPaperExecution("t8", path, 3000));
    ex = openPosition(ex);
    expect(ex.state).not.toBe("OPEN");
  });

  it("exitPosition then closePosition works", () => {
    let ex = startPrecheck(createPaperExecution("t9", path, 3000));
    ex = executeBatch(ex, 1, spotFill(900), perpFill(900));
    ex = executeBatch(ex, 2, spotFill(900), perpFill(900));
    ex = executeBatch(ex, 3, spotFill(1200), perpFill(1200));
    ex = openPosition(ex);
    ex = exitPosition(ex, "时间止损");
    expect(ex.state).toBe("EXITING");
    ex = closePosition(ex);
    expect(ex.state).toBe("CLOSED");
  });
});
