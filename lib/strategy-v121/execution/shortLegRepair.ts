import type { ShortLegAction } from "../domain/types";
import { evaluateDeviation, calcPositionDeviation } from "./deviation";

export interface RepairInput {
  spotFilledNotional: number;
  perpFilledNotional: number;
  spotCanStillBuy: boolean;
  perpCanStillShort: boolean;
  spotCanSellExit: boolean;
  perpCanBuyExit: boolean;
  batchFilledRatio: number;
}

export interface RepairDecision {
  action: ShortLegAction;
  description: string;
  freezeRequired: boolean;
}

export function decideShortLegRepair(input: RepairInput): RepairDecision {
  const deviation = calcPositionDeviation(input.spotFilledNotional, input.perpFilledNotional);
  const devLevel = evaluateDeviation(deviation);

  // 现货买到了，合约没空上
  if (input.spotFilledNotional > 0 && input.perpFilledNotional === 0) {
    if (input.perpCanStillShort) {
      return { action: "repair_perp", description: "补开合约空单", freezeRequired: false };
    }
    return { action: "exit_spot", description: "合约无法开空，卖出现货退出", freezeRequired: false };
  }

  // 合约空上了，现货没买到
  if (input.perpFilledNotional > 0 && input.spotFilledNotional === 0) {
    if (input.spotCanStillBuy) {
      return { action: "repair_spot", description: "补买现货", freezeRequired: false };
    }
    return { action: "exit_perp", description: "现货无法买入，平合约空单退出", freezeRequired: false };
  }

  // 双边部分成交但偏差 > 1%
  if (input.spotFilledNotional > 0 && input.perpFilledNotional > 0 && devLevel.level === "repair") {
    return { action: "repair_perp", description: `双边部分成交偏差${(deviation * 100).toFixed(2)}% > 1%，按短腿修复`, freezeRequired: false };
  }

  // 偏差 > 3%
  if (devLevel.level === "pause" || devLevel.level === "emergency") {
    return { action: "freeze", description: `偏差${(deviation * 100).toFixed(2)}% ${devLevel.action}`, freezeRequired: true };
  }

  // 成交不足 80% 但偏差 <= 1%
  if (input.batchFilledRatio < 0.8 && devLevel.level === "normal") {
    return { action: "repair_spot", description: "成交不足80%，保留已对冲部分，取消剩余订单", freezeRequired: false };
  }

  return { action: "repair_spot", description: "正常修复", freezeRequired: false };
}
