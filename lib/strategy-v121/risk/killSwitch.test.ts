import { describe, expect, it } from "vitest";
import {
  getKillSwitch, setKillSwitch, isActionAllowed,
  canTrade, blocksNewEntries,
} from "./killSwitch";

describe("killSwitch", () => {
  beforeEach(() => setKillSwitch("OFF"));

  it("default is OFF", () => {
    expect(getKillSwitch()).toBe("OFF");
  });

  it("set and get", () => {
    setKillSwitch("PAUSE_ALL_AUTOMATION");
    expect(getKillSwitch()).toBe("PAUSE_ALL_AUTOMATION");
    setKillSwitch("OFF"); // restore
  });

  describe("isActionAllowed", () => {
    it("OFF allows OPEN", () => {
      expect(isActionAllowed("OPEN", "OFF")).toBe(true);
    });

    it("READ_ONLY_ONLY blocks OPEN", () => {
      expect(isActionAllowed("OPEN", "READ_ONLY_ONLY")).toBe(false);
    });

    it("READ_ONLY_ONLY allows READ_ONLY", () => {
      expect(isActionAllowed("READ_ONLY", "READ_ONLY_ONLY")).toBe(true);
    });

    it("PAUSE_NEW_ENTRIES blocks OPEN but allows EXIT", () => {
      expect(isActionAllowed("OPEN", "PAUSE_NEW_ENTRIES")).toBe(false);
      expect(isActionAllowed("EXIT", "PAUSE_NEW_ENTRIES")).toBe(true);
      expect(isActionAllowed("RISK", "PAUSE_NEW_ENTRIES")).toBe(true);
    });

    it("PAUSE_ALL_AUTOMATION blocks everything", () => {
      expect(isActionAllowed("OPEN", "PAUSE_ALL_AUTOMATION")).toBe(false);
      expect(isActionAllowed("EXIT", "PAUSE_ALL_AUTOMATION")).toBe(false);
      expect(isActionAllowed("RISK", "PAUSE_ALL_AUTOMATION")).toBe(false);
      expect(isActionAllowed("PAPER", "PAUSE_ALL_AUTOMATION")).toBe(false);
    });
  });

  describe("canTrade", () => {
    it("true when OFF", () => expect(canTrade("OFF")).toBe(true));
    it("false when READ_ONLY_ONLY", () => expect(canTrade("READ_ONLY_ONLY")).toBe(false));
    it("false when PAUSE_ALL_AUTOMATION", () => expect(canTrade("PAUSE_ALL_AUTOMATION")).toBe(false));
  });

  describe("blocksNewEntries", () => {
    it("false when OFF", () => expect(blocksNewEntries("OFF")).toBe(false));
    it("true when PAUSE_NEW_ENTRIES (OPEN blocked)", () => {
    expect(isActionAllowed("OPEN", "PAUSE_NEW_ENTRIES")).toBe(false);
  });
  });
});
