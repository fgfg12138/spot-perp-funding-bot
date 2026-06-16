import { setRunState, incrementCycle, setLastError, getRunState } from "./runState";
import { emitHeartbeat } from "./heartbeat";
import { Scheduler } from "./scheduler";
import { getConfig } from "../config/strategyConfig";
import { getKillSwitch, isActionAllowed } from "../risk/killSwitch";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

export interface WorkerConfig {
  workerId: string;
  intervalMs: number;
}

export class V121Worker {
  private scheduler: Scheduler;
  private config: WorkerConfig;
  private dryRun: boolean;

  constructor(config: WorkerConfig, dryRun = false) {
    this.config = config;
    this.dryRun = dryRun;
    this.scheduler = new Scheduler(
      () => this.cycle(),
      {
        intervalMs: config.intervalMs,
        onError: (err) => { setLastError(err.message); },
        onStop: () => { setRunState("stopped"); },
      },
    );
  }

  start(): void {
    setRunState("running");
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  isRunning(): boolean {
    return this.scheduler.isRunning();
  }

  private async cycle(): Promise<void> {
    const config = getConfig();
    const mode = config.mode;
    const ks = getKillSwitch();

    // Kill switch: block execution if PAUSE_ALL_AUTOMATION
    if (ks === "PAUSE_ALL_AUTOMATION") {
      setRunState("paused");
      emitHeartbeat(this.config.workerId, mode);
      return;
    }

    if (!isActionAllowed("PAPER", ks)) {
      setRunState("paused");
      emitHeartbeat(this.config.workerId, mode);
      return;
    }

    // Cycle body (M7+ will add actual operations)
    if (!this.dryRun) {
      // TODO M7: Health check
      // TODO M7: Refresh market snapshots
      // TODO M7: Scan opportunities → persist
      // TODO M7: Advance paper lifecycle
      // TODO M7: Monitor positions
      // TODO M7: Risk checks
      // TODO M7: Persist position snapshots
    }

    incrementCycle();
    emitHeartbeat(this.config.workerId, mode);
  }
}
