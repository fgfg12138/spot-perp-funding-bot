import { getHeartbeat, type WorkerHeartbeat } from "./runState";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-worker"));

export function emitHeartbeat(workerId: string, mode: string): WorkerHeartbeat {
  const hb = getHeartbeat(workerId, mode);
  repo.save("worker_heartbeats", hb as unknown as Record<string, unknown>);
  return hb;
}

export function readHeartbeats(): WorkerHeartbeat[] {
  return repo.queryAll("worker_heartbeats") as unknown as WorkerHeartbeat[];
}
