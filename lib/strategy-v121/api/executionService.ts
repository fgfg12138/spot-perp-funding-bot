import type { BatchExecutionPlan, BatchExecutionState, ShortLegAction } from "../domain/types";
import { createBatchPlan, calcNextBatchAmount } from "../execution/batchPlan";
import { calcPositionDeviation, canProceedToNextBatch } from "../execution/deviation";
import { decideShortLegRepair, type RepairInput } from "../execution/shortLegRepair";

export interface PaperExecutionRequest {
  symbol: string;
  spotExchange: string;
  perpExchange: string;
  totalNotional: number;
}

export interface PaperExecutionResult {
  plan: BatchExecutionPlan;
  state: BatchExecutionState;
  canExecute: boolean;
  blockReason?: string;
}

export function initPaperExecution(req: PaperExecutionRequest): PaperExecutionResult {
  const plan = createBatchPlan(req.totalNotional);
  const state: BatchExecutionState = {
    plan, currentBatch: 1,
    spotFilledQty: 0, perpFilledQty: 0,
    spotAvgPrice: 0, perpAvgPrice: 0,
    actualBasis: 0, positionDeviation: 0,
    state: "pending",
  };
  return { plan, state, canExecute: true };
}

export function executeBatch(
  state: BatchExecutionState,
  batchNo: number,
  spotPrice: number,
  perpPrice: number,
  fillRatio: number
): { newState: BatchExecutionState; repairNeeded: boolean; repairAction?: ShortLegAction } {
  const plan = state.plan;
  const batch = plan.batches[batchNo - 1];
  if (!batch) throw new Error(`批次 ${batchNo} 不存在`);

  const spotQty = (batch.targetNotional / spotPrice) * fillRatio;
  const perpQty = (batch.targetNotional / perpPrice) * fillRatio;

  const newState: BatchExecutionState = {
    ...state, currentBatch: batchNo,
    spotFilledQty: state.spotFilledQty + spotQty,
    perpFilledQty: state.perpFilledQty + perpQty,
    spotAvgPrice: spotPrice, perpAvgPrice: perpPrice,
    actualBasis: perpPrice / spotPrice - 1,
    positionDeviation: calcPositionDeviation(spotQty * spotPrice, perpQty * perpPrice),
    state: fillRatio >= 1 ? "filled" : fillRatio > 0 ? "partial" : "failed",
  };

  const deviation = newState.positionDeviation;
  if (!canProceedToNextBatch(deviation) && batchNo < plan.batches.length) {
    const repairInput: RepairInput = {
      spotFilledNotional: newState.spotFilledQty * newState.spotAvgPrice,
      perpFilledNotional: newState.perpFilledQty * newState.perpAvgPrice,
      spotCanStillBuy: true, perpCanStillShort: true,
      spotCanSellExit: true, perpCanBuyExit: true,
      batchFilledRatio: fillRatio,
    };
    const repair = decideShortLegRepair(repairInput);
    return {
      newState: { ...newState, state: "repaired", shortLegAction: repair.action },
      repairNeeded: true, repairAction: repair.action,
    };
  }

  return { newState, repairNeeded: false };
}
