import { setRunState, incrementCycle, setLastError, getRunState } from "./runState";
import { emitHeartbeat } from "./heartbeat";
import { Scheduler } from "./scheduler";
import { getConfig } from "../config/strategyConfig";
import { getKillSwitch, isActionAllowed } from "../risk/killSwitch";
import { scanOpportunities } from "../opportunity/scanner";
import { paperStore } from "../execution/paperStore";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import type { MarketSnapshot } from "../domain/types";
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

    // 1. Kill Switch 检查
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

    try {
      // 2. 健康检查
      const healthy = true; // TODO M8: integrate real health check

      // 3. 刷新行情快照 (READ_ONLY/PAPER — 空快照，Worker 将来接 adapter)
      const spotSnapshots = new Map<string, MarketSnapshot>();
      const perpSnapshots = new Map<string, MarketSnapshot>();

      // 4. 扫描机会
      const scanResult = scanOpportunities({
        spotSnapshots,
        perpSnapshots,
        systemHealthy: healthy,
        activeCooldowns: [],
        plannedNotional: config.plannedNotional,
        makerRate: config.makerRate,
        takerRate: config.takerRate,
        isTakerEntry: false,
      });

      // 5. 持久化机会记录
      for (const opp of scanResult.opportunities) {
        repo.save("opportunity_records", opp as unknown as Record<string, unknown>);
      }

      // 6. PAPER 模式 — 推进 Paper 生命周期
      if (mode === "PAPER" && !this.dryRun) {
        const executions = paperStore.findAll();
        for (const ex of executions) {
          if (ex.state === "PRECHECK") continue; // needs manual batch input
          if (ex.state === "EXITING") {
            const updated = { ...ex, state: "CLOSED" as const, updatedAtUtc: Date.now() };
            paperStore.save(updated);
            repo.save("exit_executions", {
              id: `exit-${ex.id}`, position_id: ex.id, close_reason: "worker-auto",
              fully_closed: 1, closed_at_utc: Date.now(),
            });
            repo.save("final_reviews", {
              id: `review-${ex.id}`, position_id: ex.id,
              net_profit: 0, basis_profit: 0, funding_profit: 0, total_cost: 0,
              reviewed_at_utc: Date.now(),
            });
          }
        }
      }

      // 7. 持久化持仓快照
      const openExecs = paperStore.findAll().filter(e =>
        ["OPEN", "MONITORING"].includes(e.state),
      );
      for (const ex of openExecs) {
        repo.save("position_snapshots", {
          id: `snap-${ex.id}-${Date.now()}`,
          position_id: ex.id,
          timestamp_utc: Date.now(),
          spot_notional: ex.spotNotional,
          perp_notional: ex.perpNotional,
          deviation: ex.positionDeviation,
          state: ex.state,
        });
      }

      // 8. 写入入场决策和入场执行（生命周期事件）
      for (const ex of paperStore.findAll()) {
        if (ex.state === "BATCH_3_CONFIRMED" || ex.state === "OPEN") {
          repo.save("entry_decisions", {
            id: `decision-${ex.id}`,
            opportunity_id: ex.id,
            planned_position: ex.plan.totalNotional,
            expected_net_profit: 0,
            passed: 1,
            decision_reason: "paper-auto",
            decided_at_utc: Date.now(),
          });
        }
      }

      // 9. 风控检查
      // TODO M8: integrate risk arbiter

      // 10. 心跳
      incrementCycle();
      setRunState("running");
      emitHeartbeat(this.config.workerId, mode);

    } catch (err) {
      setRunState("error");
      setLastError((err as Error).message);
      emitHeartbeat(this.config.workerId, mode);
    }
  }
}
