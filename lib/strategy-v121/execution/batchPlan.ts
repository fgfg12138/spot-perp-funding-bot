import type { BatchExecutionPlan, BatchPlanItem } from "../domain/types";
import { BATCH_RATIOS } from "../domain/constants";

export function createBatchPlan(totalNotional: number): BatchExecutionPlan {
  const batches: BatchPlanItem[] = [];
  let cumulative = 0;

  for (let i = 0; i < BATCH_RATIOS.length; i++) {
    const ratio = BATCH_RATIOS[i];
    cumulative += ratio;
    batches.push({
      batchNo: i + 1,
      ratio,
      cumulativeTarget: cumulative,
      targetNotional: Math.round(totalNotional * cumulative),
    });
  }

  return { totalNotional, batches };
}

export function calcNextBatchAmount(
  plan: BatchExecutionPlan,
  currentBatch: number,
  filledNotional: number
): { amount: number; allowed: boolean; reason?: string } {
  if (currentBatch >= plan.batches.length) {
    return { amount: 0, allowed: false, reason: "所有批次已完成" };
  }

  const batchTarget = plan.batches[currentBatch].targetNotional;
  const remaining = batchTarget - filledNotional;

  if (remaining <= 0) {
    return { amount: 0, allowed: false, reason: "已超过当前批次目标" };
  }

  const totalRemaining = plan.totalNotional - filledNotional;
  const amount = Math.min(remaining, totalRemaining);

  return { amount: Math.max(0, amount), allowed: amount > 0 };
}

export function getCurrentBatch(plan: BatchExecutionPlan, filledNotional: number): BatchPlanItem | null {
  for (const batch of plan.batches) {
    if (filledNotional < batch.targetNotional) {
      return batch;
    }
  }
  return null;
}
