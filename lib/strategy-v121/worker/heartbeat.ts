import { getHeartbeat, type WorkerHeartbeat } from "./runState";
import { getRepository } from "../persistence/repositoryFactory";

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
  } as any);

  return hb;
}

export function readHeartbeats(): WorkerHeartbeat[] {
  return repo().queryAll("worker_heartbeat").map((row: any) => ({
    workerId: row.workerId ?? row.worker_id ?? row.id,
    state: row.state,
    mode: row.mode,
    lastCycleAtUtc: Number(row.lastCycleAtUtc ?? row.last_cycle_at_utc ?? 0),
    cycleCount: Number(row.cycleCount ?? row.cycle_count ?? 0),
    lastError: row.lastError ?? row.last_error ?? undefined,
  })) as WorkerHeartbeat[];
}
