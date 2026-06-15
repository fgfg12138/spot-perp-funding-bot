import { DEVIATION_LIMITS } from "../domain/constants";

export type DeviationLevel = "normal" | "repair" | "pause" | "emergency";

export interface DeviationResult {
  deviation: number;
  level: DeviationLevel;
  action: string;
}

export function calcPositionDeviation(
  spotNotional: number,
  perpNotional: number
): number {
  const max = Math.max(spotNotional, perpNotional);
  if (max <= 0) return 0;
  return Math.abs(spotNotional - perpNotional) / max;
}

export function evaluateDeviation(deviation: number): DeviationResult {
  if (deviation <= DEVIATION_LIMITS.NORMAL) {
    return { deviation, level: "normal", action: "正常" };
  }
  if (deviation <= DEVIATION_LIMITS.REPAIR) {
    return { deviation, level: "repair", action: "修正，不允许继续加仓" };
  }
  if (deviation <= DEVIATION_LIMITS.PAUSE) {
    return { deviation, level: "pause", action: "暂停所有新开仓，优先修复" };
  }
  return { deviation, level: "emergency", action: "执行事故，立即处理" };
}

export function canProceedToNextBatch(deviation: number): boolean {
  return deviation <= DEVIATION_LIMITS.NORMAL;
}
