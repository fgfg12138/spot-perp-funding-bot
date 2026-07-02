import { setRunState, incrementCycle, setLastError, getRunState } from "./runState";
import { emitHeartbeat } from "./heartbeat";
import { Scheduler } from "./scheduler";
import { getConfig } from "../config/strategyConfig";
import { getKillSwitch, isActionAllowed } from "../risk/killSwitch";
import { scanOpportunities } from "../opportunity/scanner";
import { paperStore } from "../execution/paperStore";
import { refreshAndScan } from "../market/marketRefreshService";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import type { MarketSnapshot } from "../domain/types";
import * as path from "node:path";
import { auditInfo, auditWarn, auditError, AuditCategory, setAuditEnabled } from "../ops/auditLogger";
import { tryAutoEntry, tryAutoMonitor } from "./workerAutoExecution";
import { getMaxDynamicSymbolsPerExchange } from "../config/runtimeConfig";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

export interface WorkerConfig {
  workerId: string;
  intervalMs: number;
}

export class V121Worker {
  private scheduler: Scheduler;
  private config: WorkerConfig;
  private dryRun: boolean;
  private scanning = false;
  private consecutiveErrors = 0;
  private readonly maxConsecutiveErrors = 5;

  constructor(config: WorkerConfig, dryRun = false) {
    this.config = config;
    this.dryRun = dryRun;
    // 使用 fixedDelay 模式：等上一个 cycle 完成后才间隔 intervalMs
    // 避免 setInterval 在 async task 未完成时重复触发
    this.scheduler = new Scheduler(
      () => this.cycle(),
      {
        intervalMs: config.intervalMs,
        fixedDelay: true, // ← 改为 fixedDelay，而非 fixedRate
        onError: (err) => { setLastError(err.message); },
        onStop: () => { setRunState("stopped"); },
      },
    );
  }

  start(): void {
    setRunState("running");
    this.scheduler.start();
    auditInfo(AuditCategory.WORKER_LIFECYCLE, "Worker 启动", {
      workerId: this.config.workerId,
      detail: { intervalMs: this.config.intervalMs, dryRun: this.dryRun },
    });
  }

  stop(): void {
    this.scheduler.stop();
    auditInfo(AuditCategory.WORKER_LIFECYCLE, "Worker 停止", {
      workerId: this.config.workerId,
    });
  }

  isRunning(): boolean {
    return this.scheduler.isRunning();
  }

  private async cycle(): Promise<void> {
    const config = getConfig();
    const mode = config.mode;
    const ks = getKillSwitch();

    // 重入保护
    if (this.scanning) {
      auditWarn(AuditCategory.WORKER_LIFECYCLE, "Worker cycle 重入保护触发 — 跳过本轮", {
        workerId: this.config.workerId,
      });
      emitHeartbeat(this.config.workerId, mode);
      return;
    }

    // Kill switch
    if (ks === "PAUSE_ALL_AUTOMATION") {
      setRunState("paused");
      auditWarn(AuditCategory.AUDIT_GATE, "Kill Switch PAUSE_ALL_AUTOMATION 触发，Worker 暂停", {
        workerId: this.config.workerId,
      });
      emitHeartbeat(this.config.workerId, mode);
      return;
    }
    if (!isActionAllowed("PAPER", ks)) {
      setRunState("paused");
      auditWarn(AuditCategory.AUDIT_GATE, `Kill Switch ${ks} 阻止 PAPER 操作`, {
        workerId: this.config.workerId,
      });
      emitHeartbeat(this.config.workerId, mode);
      return;
    }

    this.scanning = true;
    try {
      // 2. 刷新真实行情 + 扫描机会 + 持久化
      const refreshResult = await refreshAndScan({
        plannedNotional: config.plannedNotional,
        makerRate: config.makerRate,
        takerRate: config.takerRate,
        isTakerEntry: false,
        systemHealthy: true,
        maxDynamicSymbolsPerExchange: getMaxDynamicSymbolsPerExchange(),
      });

      // 3. 记录行情错误（不中断 Worker）
      for (const err of refreshResult.errors) {
        console.warn(`[worker] ${err.exchange}/${err.symbol}: ${err.error}`);
        auditWarn(AuditCategory.MARKET_REFRESH, `${err.exchange}/${err.symbol}: ${err.error}`, {
          workerId: this.config.workerId,
          exchange: err.exchange,
          symbol: err.symbol,
          detail: { error: err.error },
        });
      }

      // 4. 机会记录已在 refreshAndScan 中持久化到 opportunity_records

      // 5. PAPER 模式 — 推进 Paper 生命周期
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

      // 9. 自动开仓（SHADOW / MAINNET_TINY / CONTROLLED_LIVE 模式）
      if (mode !== "READ_ONLY" && mode !== "PAPER" && !this.dryRun) {
        const entryResult = await tryAutoEntry(this.config.workerId);
        if (entryResult.action === "order_placed" || entryResult.action === "transfer_required") {
          auditInfo(AuditCategory.WORKER_LIFECYCLE, `自动开仓结果: ${entryResult.action}`, {
            workerId: this.config.workerId,
            detail: { action: entryResult.action, symbol: entryResult.symbol, exchange: entryResult.exchange, message: entryResult.message },
          });
        } else if (entryResult.action === "skipped") {
          // 无合格机会 — 静默跳过
        } else {
          auditWarn(AuditCategory.WORKER_LIFECYCLE, `自动开仓未执行: ${entryResult.message}`, {
            workerId: this.config.workerId,
            detail: { action: entryResult.action, symbol: entryResult.symbol, exchange: entryResult.exchange },
          });
        }
      }

      // 10. 持仓监控与自动平仓
      if (mode !== "READ_ONLY" && !this.dryRun) {
        const monitorResult = await tryAutoMonitor(this.config.workerId);
        const closeActions = monitorResult.actions.filter(a => a.action === "close_executed");
        for (const ca of closeActions) {
          auditInfo(AuditCategory.WORKER_LIFECYCLE, `自动平仓: ${ca.symbol}`, {
            workerId: this.config.workerId,
            detail: { positionId: ca.positionId, message: ca.message },
          });
        }
        const freezeActions = monitorResult.actions.filter(a => a.action === "freeze" || a.action === "error");
        for (const fa of freezeActions) {
          auditWarn(AuditCategory.WORKER_LIFECYCLE, `持仓异常: ${fa.symbol} ${fa.action}`, {
            workerId: this.config.workerId,
            detail: { positionId: fa.positionId, message: fa.message },
          });
        }
      }

      // 11. 风控检查
      // TODO M8: integrate risk arbiter

      // 12. 心跳
      incrementCycle();
      this.consecutiveErrors = 0;
      setRunState("running");
      emitHeartbeat(this.config.workerId, mode);

    } catch (err) {
      this.consecutiveErrors++;
      auditError(AuditCategory.WORKER_LIFECYCLE, `Worker cycle 异常 (连续 ${this.consecutiveErrors}/${this.maxConsecutiveErrors})`, {
        workerId: this.config.workerId,
        error: err as Error,
        detail: { consecutiveErrors: this.consecutiveErrors },
      });
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        setRunState("error");
      } else {
        setRunState("running");
      }
      setLastError((err as Error).message);
      emitHeartbeat(this.config.workerId, mode);
    } finally {
      this.scanning = false;
    }
  }
}
