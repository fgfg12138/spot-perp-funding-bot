/**
 * Kill Switch — global execution control.
 *
 * Priority order:
 *   OFF < READ_ONLY_ONLY < PAUSE_NEW_ENTRIES < PAUSE_ALL_AUTOMATION
 */

export type KillSwitchState =
  | "OFF"
  | "READ_ONLY_ONLY"
  | "PAUSE_NEW_ENTRIES"
  | "PAUSE_ALL_AUTOMATION";

let currentKillSwitch: KillSwitchState = "OFF";

export function getKillSwitch(): KillSwitchState {
  return currentKillSwitch;
}

export function setKillSwitch(state: KillSwitchState): void {
  currentKillSwitch = state;
}

/**
 * Check if a given action is allowed under the current kill switch.
 *
 * @param action - The intent: "READ_ONLY", "PAPER", "EXECUTE", "EXIT", "RISK", "OPEN"
 */
export function isActionAllowed(
  action: "READ_ONLY" | "PAPER" | "OPEN" | "EXIT" | "RISK" | "SHADOW",
  killSwitch?: KillSwitchState
): boolean {
  const ks = killSwitch ?? currentKillSwitch;

  switch (ks) {
    case "OFF":
      return true;
    case "READ_ONLY_ONLY":
      return action === "READ_ONLY" || action === "PAPER" || action === "SHADOW";
    case "PAUSE_NEW_ENTRIES":
      return action === "READ_ONLY" || action === "PAPER" || action === "SHADOW" || action === "EXIT" || action === "RISK";
    case "PAUSE_ALL_AUTOMATION":
      return false;
  }
}

/**
 * Check if any real trading is allowed at all.
 */
export function canTrade(killSwitch?: KillSwitchState): boolean {
  return isActionAllowed("OPEN", killSwitch);
}

/**
 * Convenience: kill switch blocks all new positions.
 */
export function blocksNewEntries(killSwitch?: KillSwitchState): boolean {
  return !isActionAllowed("OPEN", killSwitch) || !isActionAllowed("EXIT", killSwitch);
}
