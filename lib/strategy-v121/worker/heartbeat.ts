import { getHeartbeat, type WorkerHeartbeat, type RunState } from "./runState";
import { getRepository } from "../persistence/repositoryFactory";
import {
  type WorkerHeartbeatRow,
  readString,
  readTimestamp,
  readNumber,
} from "../persistence/repositoryRowTypes";

function repo() { return getRepository(); }

export function emitHeartbeat(workerId: string, mode: string): WorkerHeartbeat {
  const hb = getHeartbeat(workerId, mode);

  repo().save("worker_heartbeat", {
    id: workerId,
    worker_id: hb.workerId,
    state: hb.state,
    mode: hb.mode,
    last_cycle_at_utc: hb.lastCycleAtUtc,
    cycle_count: hb.cycleCount,
    last_error: hb.lastError ?? null,
  });

  return hb;
}

export function readHeartbeats(): WorkerHeartbeat[] {
  return (repo().queryAll("worker_heartbeat") as unknown as WorkerHeartbeatRow[]).map((row) => ({
    workerId: readString(row, ["workerId", "worker_id", "id"]),
    state: readString(row, ["state"]) as RunState,
    mode: readString(row, ["mode"]),
    lastCycleAtUtc: readTimestamp(row, ["lastCycleAtUtc", "last_cycle_at_utc"]),
    cycleCount: readNumber(row, ["cycleCount", "cycle_count"]),
    lastError: readString(row, ["lastError", "last_error"]) || undefined,
  }));
}
