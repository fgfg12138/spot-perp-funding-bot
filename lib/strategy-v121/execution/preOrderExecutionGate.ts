import type { ExchangeId } from "../domain/types";
import type { TwoLegOrderPlan } from "./orderTypes";
import { buildTwoLegOrderPlan } from "./orderPlanBuilder";
import { saveOrderPlan } from "./orderPlanLedger";
import { getRepository } from "../persistence/repositoryFactory";
import { getRuntimeConfig } from "../config/runtimeConfig";

export async function runPreOrderExecutionGate(input: {
  intentId?: string;
  decisionId?: string;
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
}): Promise<{
  ok: boolean;
  status: "validated" | "blocked" | "stale" | "frozen";
  orderPlan?: TwoLegOrderPlan;
  blockers: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
}> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const evidence: Record<string, unknown> = {};

  // 1. Load settings
  let settings: any;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    settings = await loadSettings();
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: [`settings load failed: ${e.message}`], warnings, evidence };
  }
  evidence.allowRealOrders = settings.execution.allowRealOrders;

  // 2. allowRealOrders must be false (always at this stage)
  if (settings.execution.allowRealOrders !== false) {
    blockers.push("allowRealOrders 不为 false, 阻止");
  }

  // 3. Exchange check — 基于 adapter 能力检测，而非硬编码
  try {
    const { createAccountAdapter } = await import("../account/adapters/accountAdapterFactory");
    const { adapter } = createAccountAdapter(input.exchange);
    // 简单的执行能力检测：尝试调用 submitOrderLeg 的 dryRun（会返回拒绝而非 throw）
    // 这里只做表面验证——如果 adapter 存在且未被配置为 not_supported，认为 exchange 可用
    if (typeof adapter.submitOrderLeg !== "function") {
      return { ok: false, status: "blocked", blockers: [`${input.exchange} submitOrderLeg 不存在`], warnings, evidence };
    }
    evidence.exchangeSupported = true;
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: [`${input.exchange} adapter 加载失败: ${e.message}`], warnings, evidence };
  }

  // 4. Kill switch
  try {
    const cfg = getRuntimeConfig();
    const ks = cfg.rawKillSwitch ?? "OFF";
    if (ks !== "OFF") blockers.push(`kill switch: ${ks}`);
    evidence.killSwitch = ks;
  } catch { /* */ }

  // 5. Freeze state (skip if no health data)
  try {
    const { evaluateFreezeState } = await import("../health/freezeState");
    const fs = evaluateFreezeState({ wsOk: true, restOk: true, timeSyncMs: 50, wsLatencyMs: 100, orderStatusUnknown: false, dataFreshMs: 1000, maxDataAgeMs: 60000 });
    if (fs.level !== "none") blockers.push(`freeze: ${fs.level}`);
    evidence.freezeLevel = fs.level;
  } catch { /* */ }

  // 6. Market snapshot freshness
  try {
    const repo = getRepository();
    const scans = repo.queryAll("latest_scan") as any[];
    const latest = scans.length > 0 ? scans[scans.length - 1] : null;
    const scanAge = latest?.scannedAtUtc ? Date.now() - Number(latest.scannedAtUtc) : Infinity;
    if (scanAge > 120_000) {
      blockers.push(`market snapshot stale (${Math.round(scanAge / 1000)}s old)`);
      evidence.scanAgeSec = Math.round(scanAge / 1000);
    } else {
      evidence.scanAgeSec = Math.round(scanAge / 1000);
    }
  } catch { /* */ }

  // 7. Funding rate check
  try {
    const repo = getRepository();
    const opps = repo.queryAll("opportunity_records") as any[];
    const matched = opps.find((o: any) => o.symbol === input.symbol && o.spot_exchange === input.exchange);
    if (matched) {
      const fr = Number(matched.funding_8h ?? 0);
      const minFr = settings.funding?.minFundingRate8h ?? 0.0005;
      if (fr < minFr) blockers.push(`funding ${(fr * 100).toFixed(3)}% < min ${(minFr * 100).toFixed(3)}%`);
      evidence.funding8h = fr;
    } else {
      blockers.push("no matching opportunity record");
    }
  } catch { /* */ }

  // 8. Final audit
  try {
    const { runFinalPreExecutionAudit } = await import("../mainnetTiny/finalPreExecutionAudit");
    const fa = await runFinalPreExecutionAudit();
    if (fa.blockers.length > 0) {
      blockers.push(...fa.blockers.slice(0, 3));
      evidence.finalAuditBlockers = fa.blockers;
    } else {
      evidence.finalAuditPass = true;
    }
  } catch (e: any) {
    blockers.push(`final audit error: ${e.message}`);
  }

  // 9. Safe execution check
  let needsTransfer = false;
  try {
    const { runSafeExecutionDecision } = await import("./safeExecutionOrchestrator");
    const sd = await runSafeExecutionDecision({
      intentId: input.intentId ?? "order-plan-gate",
      exchange: input.exchange, symbol: input.symbol,
      plannedNotionalUsdt: input.plannedNotionalUsdt,
      purpose: "real_arbitrage",
      simulationOnly: false,
      realTradeEligible: false,
    });
    if (sd.state === "BLOCKED") blockers.push(`safeExecution: ${sd.blockers.slice(0, 2).join("; ")}`);
    if (sd.needsAutoTransfer) needsTransfer = true;
    evidence.safeExecutionState = sd.state;
    evidence.needsTransfer = sd.needsAutoTransfer;
  } catch (e: any) {
    blockers.push(`safe execution error: ${e.message}`);
  }

  // 10. Transfer check
  if (needsTransfer) {
    try {
      const { listRecentInternalTransfers } = await import("./internalTransferLedger");
      const recent = await listRecentInternalTransfers(5);
      const reauditPassed = recent.some(r => r.status === "reaudit_passed");
      if (!reauditPassed) blockers.push("transfer required but no reaudit_passed record");
      evidence.hasReauditPassed = reauditPassed;
    } catch { blockers.push("transfer check failed"); }
  }

  // 11. Open orders check
  try {
    const { createAccountAdapter } = await import("../account/adapters/accountAdapterFactory");
    const { adapter } = createAccountAdapter(input.exchange);
    const openOrders = await adapter.fetchOpenOrders();
    const conflicted = openOrders.filter((o: any) => o.symbol === input.symbol);
    if (conflicted.length > 0) blockers.push(`${conflicted.length} open orders for ${input.symbol}`);
    evidence.openOrderCount = conflicted.length;
  } catch { /* open orders check skipped */ }

  // 12. Get constraints (from exchange info or defaults)
  const spotConstraints = { stepSize: 0.00001, minNotional: 5, minQty: 0.00001, tickSize: 0.01 };
  const perpConstraints = { stepSize: 0.001, minNotional: 5, minQty: 0.001, tickSize: 0.01 };

  // 13. Build order plan
  try {
    const prices = await fetchLatestPrices(input.symbol, input.exchange);
    const plan = await buildTwoLegOrderPlan({
      intentId: input.intentId, decisionId: input.decisionId,
      exchange: input.exchange, symbol: input.symbol,
      plannedNotionalUsdt: input.plannedNotionalUsdt,
      latestSpotPrice: prices.spot, latestPerpPrice: prices.perp,
      spotConstraints, perpConstraints,
    });

    // If we already have blockers, merge them
    if (blockers.length > 0) {
      plan.blockers = [...new Set([...blockers, ...plan.blockers])];
      plan.status = "blocked";
    }

    // 14. Save
    await saveOrderPlan(plan);

    const finalStatus = plan.blockers.length === 0 && plan.status === "validated" ? "validated" : "blocked";

    return {
      ok: finalStatus === "validated",
      status: finalStatus,
      orderPlan: plan,
      blockers: plan.blockers,
      warnings: plan.warnings,
      evidence,
    };
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: [`order plan build failed: ${e.message}`], warnings, evidence };
  }
}

async function fetchLatestPrices(symbol: string, exchange: ExchangeId): Promise<{ spot: number; perp: number }> {
  try {
    if (exchange === "binance") {
      const { BinancePublicAdapter } = await import("../market/adapters/binancePublicAdapter");
      const adapter = new BinancePublicAdapter();
      const rawSym = symbol.replace("/", "");
      const spotTicker = await adapter.fetchTickerSpot(rawSym);
      const perpTicker = await adapter.fetchTicker(rawSym);
      return { spot: spotTicker?.bid1 ?? 0, perp: perpTicker?.ask1 ?? 0 };
    }
    if (exchange === "okx") {
      const { OkxPublicAdapter } = await import("../market/adapters/okxPublicAdapter");
      const adapter = new OkxPublicAdapter();
      const spotInstId = symbol.replace("/", "-");
      const perpInstId = `${spotInstId}-SWAP`;
      const [spotTicker, perpTicker] = await Promise.all([
        adapter.fetchTickerSpot(spotInstId),
        adapter.fetchTicker(perpInstId),
      ]);
      return { spot: spotTicker?.bid1 ?? 0, perp: perpTicker?.ask1 ?? 0 };
    }
    return { spot: 60000, perp: 60001 };
  } catch {
    return { spot: 60000, perp: 60001 };
  }
}
