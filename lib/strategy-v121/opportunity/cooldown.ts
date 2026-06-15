import { COOLDOWN } from "../domain/constants";

export type CooldownEvent = "entry_failure" | "normal_exit" | "risk_exit" | "stop_loss" | "exchange_anomaly";

export interface CooldownRecord {
  pathKey: string;
  event: CooldownEvent;
  startedAtUtc: number;
  durationMinutes: number;
}

const COOLDOWN_DURATIONS: Record<CooldownEvent, number> = {
  entry_failure: COOLDOWN.ENTRY_FAILURE,
  normal_exit: COOLDOWN.NORMAL_EXIT,
  risk_exit: COOLDOWN.RISK_EXIT,
  stop_loss: COOLDOWN.STOP_LOSS_EXIT,
  exchange_anomaly: COOLDOWN.EXCHANGE_ANOMALY,
};

export function createCooldown(pathKey: string, event: CooldownEvent): CooldownRecord {
  return {
    pathKey,
    event,
    startedAtUtc: Date.now(),
    durationMinutes: COOLDOWN_DURATIONS[event],
  };
}

export function isInCooldown(
  pathKey: string,
  activeCooldowns: CooldownRecord[]
): { inCooldown: boolean; remainingMinutes: number } {
  const now = Date.now();

  for (const cd of activeCooldowns) {
    if (cd.pathKey !== pathKey) continue;
    const elapsed = (now - cd.startedAtUtc) / 1000 / 60;
    if (elapsed < cd.durationMinutes) {
      return { inCooldown: true, remainingMinutes: cd.durationMinutes - elapsed };
    }
  }

  return { inCooldown: false, remainingMinutes: 0 };
}

export function pruneExpiredCooldowns(cooldowns: CooldownRecord[]): CooldownRecord[] {
  const now = Date.now();
  return cooldowns.filter(cd => {
    const elapsed = (now - cd.startedAtUtc) / 1000 / 60;
    return elapsed < cd.durationMinutes;
  });
}

export { COOLDOWN_DURATIONS };
