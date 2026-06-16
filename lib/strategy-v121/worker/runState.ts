export type RunState = "stopped" | "running" | "paused" | "error";

export interface WorkerHeartbeat {
  workerId: string;
  state: RunState;
  mode: string;
  lastCycleAtUtc: number;
  cycleCount: number;
  lastError?: string;
}

let currentState: RunState = "stopped";
let cycleCount = 0;
let lastCycleAtUtc = 0;
let lastError: string | undefined;

export function setRunState(s: RunState): void { currentState = s; }
export function getRunState(): RunState { return currentState; }
export function incrementCycle(): void { cycleCount++; lastCycleAtUtc = Date.now(); }
export function setLastError(err: string): void { lastError = err; }
export function getCycleCount(): number { return cycleCount; }
export function getLastCycleAtUtc(): number { return lastCycleAtUtc; }

export function getHeartbeat(workerId: string, mode: string): WorkerHeartbeat {
  return { workerId, state: currentState, mode, lastCycleAtUtc, cycleCount, lastError };
}
