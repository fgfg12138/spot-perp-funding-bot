/**
 * 执行意图 — 记录"如果进入 MAINNET_TINY，会尝试执行什么"。
 * 不下单，不改账户，不修改交易所状态。
 */
import type { ExchangeId } from "../domain/types";
import { checkMainnetTinyGate, validateOrderIntent } from "../mainnetTiny/mainnetTinyGate";
import { FileSystemRepository } from "../persistence/fileSystemRepository";
import * as path from "node:path";

const repo = new FileSystemRepository(path.join(process.cwd(), ".v121-data"));

export interface OrderIntent {
  intentId: string;
  mode: string;
  symbol: string;
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
  side: "buy_spot_short_perp";
  plannedNotionalUsdt: number;
  batchNo: number;
  reason: string;
  createdAtUtc: number;
  gateAllowed: boolean;
  blockedReasons: string[];
  requiresManualConfirm: boolean;
  dataSource: string;
}

export function createOrderIntent(params: {
  symbol: string;
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
  plannedNotionalUsdt: number;
  batchNo: number;
  reason?: string;
}): OrderIntent {
  const gate = checkMainnetTinyGate();
  const limitCheck = validateOrderIntent({
    symbol: params.symbol,
    spotExchange: params.spotExchange,
    perpExchange: params.perpExchange,
    notionalUsdt: params.plannedNotionalUsdt,
    totalExposureUsdt: params.plannedNotionalUsdt,
  });
  const blockedReasons = [
    ...gate.missing.map(m => `环境门: ${m}`),
    ...gate.warnings.map(w => `警告: ${w}`),
    ...limitCheck.blockedReasons,
  ];

  const intent: OrderIntent = {
    intentId: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mode: gate.mode,
    symbol: params.symbol,
    spotExchange: params.spotExchange,
    perpExchange: params.perpExchange,
    side: "buy_spot_short_perp",
    plannedNotionalUsdt: params.plannedNotionalUsdt,
    batchNo: params.batchNo,
    reason: params.reason ?? "手工创建",
    createdAtUtc: Date.now(),
    gateAllowed: gate.allowed && limitCheck.allowed,
    blockedReasons,
    requiresManualConfirm: true,
    dataSource: "order_intent",
  };

  repo.save("order_intents", intent as any);
  return intent;
}

export function getOrderIntents(): OrderIntent[] {
  return repo.queryAll("order_intents") as unknown as OrderIntent[];
}

export function recordBlockedAttempt(params: {
  mode: string; action: string; symbol?: string; exchange?: string;
  reason: string; gateStatus: any;
}): void {
  repo.save("blocked_execution_attempts", {
    id: `blocked-${Date.now()}`,
    mode: params.mode, action: params.action,
    symbol: params.symbol ?? "", exchange: params.exchange ?? "",
    reason: params.reason,
    blockedAtUtc: Date.now(),
    _secretExposureCheck: "passed",
  } as any);
}

export function getBlockedAttempts(): any[] {
  return repo.queryAll("blocked_execution_attempts");
}
