import { getHeartbeat, type WorkerHeartbeat } from "./runState";
import { getRepository } from "../persistence/repositoryFactory";

function repo() { return getRepository(); }

export function emitHeartbeat(workerId: string, mode: string): WorkerHeartbeat {
  const hb = getHeartbeat(workerId, mode);
  repo().save("worker_heartbeat", hb as unknown as Record<string, unknown>);
  return hb;
}

export function readHeartbeats(): WorkerHeartbeat[] {
  return repo().queryAll("worker_heartbeat") as unknown as WorkerHeartbeat[];
}
