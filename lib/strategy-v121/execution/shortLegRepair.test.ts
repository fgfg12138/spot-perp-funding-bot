import { describe, expect, it } from "vitest";
import { decideShortLegRepair } from "./shortLegRepair";

describe("decideShortLegRepair", () => {
  it("spot filled, perp empty → repair perp if possible", () => {
    const r = decideShortLegRepair({
      spotFilledNotional: 1000, perpFilledNotional: 0,
      spotCanStillBuy: true, perpCanStillShort: true,
      spotCanSellExit: true, perpCanBuyExit: true,
      batchFilledRatio: 0.5,
    });
    expect(r.action).toBe("repair_perp");
    expect(r.freezeRequired).toBe(false);
  });

  it("spot filled, perp empty, cannot short → exit spot", () => {
    const r = decideShortLegRepair({
      spotFilledNotional: 1000, perpFilledNotional: 0,
      spotCanStillBuy: true, perpCanStillShort: false,
      spotCanSellExit: true, perpCanBuyExit: true,
      batchFilledRatio: 0.5,
    });
    expect(r.action).toBe("exit_spot");
  });

  it("perp filled, spot empty → repair spot if possible", () => {
    const r = decideShortLegRepair({
      spotFilledNotional: 0, perpFilledNotional: 1000,
      spotCanStillBuy: true, perpCanStillShort: true,
      spotCanSellExit: true, perpCanBuyExit: true,
      batchFilledRatio: 0.5,
    });
    expect(r.action).toBe("repair_spot");
  });

  it("both partial >3% deviation → freeze", () => {
    const r = decideShortLegRepair({
      spotFilledNotional: 1000, perpFilledNotional: 800,
      spotCanStillBuy: true, perpCanStillShort: true,
      spotCanSellExit: true, perpCanBuyExit: true,
      batchFilledRatio: 0.5,
    });
    expect(r.freezeRequired).toBe(true);
  });
});
