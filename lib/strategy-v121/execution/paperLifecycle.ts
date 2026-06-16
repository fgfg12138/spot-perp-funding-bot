import type {
  BatchExecutionPlan, BatchExecutionState, BatchPlanItem,
  ShortLegAction, PositionSnapshot, RiskDecision, ADLLevel, HealthStatus,
  ArbitragePath,
} from "../domain/types";
import { createBatchPlan } from "./batchPlan";
import { calcPositionDeviation, canProceedToNextBatch } from "./deviation";
import { decideShortLegRepair, type RepairInput } from "./shortLegRepair";

export type PaperState =
  | "IDLE"
  | "PRECHECK"
  | "BATCH_1_EXECUTING"
  | "BATCH_1_CONFIRMED"
  | "BATCH_2_EXECUTING"
  | "BATCH_2_CONFIRMED"
  | "BATCH_3_EXECUTING"
  | "BATCH_3_CONFIRMED"
  | "OPEN"
  | "MONITORING"
  | "EXITING"
  | "CLOSED"
  | "SHORT_LEG"
  | "FROZEN"
  | "FAILED";

export interface PaperExecution {
  id: string;
  state: PaperState;
  plan: BatchExecutionPlan;
  path: ArbitragePath;
  spotFilledQty: number;
  perpFilledQty: number;
  spotAvgPrice: number;
  perpAvgPrice: number;
  spotNotional: number;
  perpNotional: number;
  actualBasis: number;
  positionDeviation: number;
  createdAtUtc: number;
  updatedAtUtc: number;
  logs: string[];
}

export interface FillResult {
  qty: number;
  avgPrice: number;
  notional: number;
}

export function createPaperExecution(
  id: string,
  path: ArbitragePath,
  totalNotional: number
): PaperExecution {
  return {
    id,
    state: "IDLE",
    plan: createBatchPlan(totalNotional),
    path,
    spotFilledQty: 0, perpFilledQty: 0,
    spotAvgPrice: 0, perpAvgPrice: 0,
    spotNotional: 0, perpNotional: 0,
    actualBasis: 0, positionDeviation: 0,
    createdAtUtc: Date.now(), updatedAtUtc: Date.now(),
    logs: [`[${new Date().toISOString()}] 执行 ${id} 已创建`],
  };
}

export function startPrecheck(ex: PaperExecution): PaperExecution {
  return transition(ex, "PRECHECK", "进入开仓前检查");
}

export function executeBatch(
  ex: PaperExecution,
  batchNo: number,
  spotFill: FillResult | null,
  perpFill: FillResult | null
): PaperExecution {
  const batchState: Record<number, PaperState> = {
    1: "BATCH_1_EXECUTING", 2: "BATCH_2_EXECUTING", 3: "BATCH_3_EXECUTING",
  };
  const confirmedState: Record<number, PaperState> = {
    1: "BATCH_1_CONFIRMED", 2: "BATCH_2_CONFIRMED", 3: "BATCH_3_CONFIRMED",
  };

  if (!batchState[batchNo]) return log(ex, `无效批次 ${batchNo}`);

  let next = transition(ex, batchState[batchNo], `执行第 ${batchNo} 批`);

  if (!spotFill && !perpFill) {
    return transition(next, "FAILED", `第 ${batchNo} 批双方均未成交`);
  }

  // Handle short leg
  if ((spotFill && !perpFill) || (!spotFill && perpFill)) {
    const repairInput: RepairInput = {
      spotFilledNotional: spotFill?.notional ?? 0,
      perpFilledNotional: perpFill?.notional ?? 0,
      spotCanStillBuy: true,
      perpCanStillShort: true,
      spotCanSellExit: true,
      perpCanBuyExit: true,
      batchFilledRatio: 0.5,
    };
    const repair = decideShortLegRepair(repairInput);
    if (repair.freezeRequired) {
      return transition(next, "FROZEN", `短腿冻结: ${repair.description}`);
    }
    return transition(next, "SHORT_LEG", `短腿: ${repair.description}`);
  }

  // Both filled — update totals
  next.spotFilledQty += spotFill!.qty;
  next.perpFilledQty += perpFill!.qty;
  next.spotAvgPrice = spotFill!.avgPrice;
  next.perpAvgPrice = perpFill!.avgPrice;
  next.spotNotional += spotFill!.notional;
  next.perpNotional += perpFill!.notional;
  next.positionDeviation = calcPositionDeviation(next.spotNotional, next.perpNotional);

  // Check deviation
  if (!canProceedToNextBatch(next.positionDeviation)) {
    return transition(next, "SHORT_LEG",
      `偏差 ${(next.positionDeviation * 100).toFixed(2)}% > 1%，需修复`);
  }

  return transition(next, confirmedState[batchNo], `第 ${batchNo} 批已确认`);
}

export function openPosition(ex: PaperExecution): PaperExecution {
  if (ex.state !== "BATCH_3_CONFIRMED") {
    return log(ex, "未完成全部批次，不能开仓");
  }
  return transition(ex, "OPEN", "仓位已建立 → MONITORING");
}

export function startMonitoring(ex: PaperExecution): PaperExecution {
  if (ex.state !== "OPEN") return log(ex, "无持仓可监控");
  return transition(ex, "MONITORING", "持仓监控中");
}

export function exitPosition(ex: PaperExecution, reason: string): PaperExecution {
  if (!["OPEN", "MONITORING"].includes(ex.state)) {
    return log(ex, "无持仓可平仓");
  }
  return transition(ex, "EXITING", `平仓: ${reason}`);
}

export function closePosition(ex: PaperExecution): PaperExecution {
  return transition(ex, "CLOSED", "仓位已平");
}

export function reviewPosition(ex: PaperExecution): PaperExecution {
  return transition(ex, "CLOSED", "复盘完成");
}

export function freezeExecution(ex: PaperExecution, reason: string): PaperExecution {
  return transition(ex, "FROZEN", `冻结: ${reason}`);
}

// ─── helpers ──────────────────────────────────────

function transition(ex: PaperExecution, newState: PaperState, msg: string): PaperExecution {
  return {
    ...ex,
    state: newState,
    updatedAtUtc: Date.now(),
    logs: [...ex.logs, `[${new Date().toISOString()}] ${msg}`],
  };
}

function log(ex: PaperExecution, msg: string): PaperExecution {
  return { ...ex, logs: [...ex.logs, `[${new Date().toISOString()}] ${msg}`] };
}
