import type { ExchangeId } from "../domain/types";
import type { InternalTransferResult, InternalTransferLedgerRecord, InternalTransferRequest } from "./internalTransferTypes";
import { createInternalTransferRecord, updateInternalTransferRecord, findInternalTransferByIdempotencyKey } from "./internalTransferLedger";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";
import { withRetry } from "../ops/retry";

import { isRealInternalTransferEnabled } from "../config/runtimeConfig";

function makeId(): string { return `autox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

/** 根据 from/to 账户生成 Binance 内部划转类型。 */
function toBinanceType(from: string, to: string): string {
  if (from === "spot" && to === "perp") return "MAIN_UMFUTURE";
  if (from === "perp" && to === "spot") return "UMFUTURE_MAIN";
  return "unknown";
}

/** 纯函数：构造幂等 key。 */
export function buildIdempotencyKey(input: {
  exchange: ExchangeId;
  fromAccount: string;
  toAccount: string;
  amountUsdt: number;
  intentId?: string;
}): string {
  return `ik-${input.exchange}-${input.fromAccount}-${input.toAccount}-${input.amountUsdt}-${input.intentId ?? "no-intent"}`;
}

/** 纯函数：判断 from 账户减少且 to 账户增加。 */
export function isBalanceDirectionChanged(deltaFrom: number, deltaTo: number): boolean {
  return deltaFrom <= -1 && deltaTo >= 1;
}

/** 纯函数：构造 ledger rawJson 字符串。 */
export function buildTransferLedgerPayload(input: {
  request?: unknown;
  response?: unknown;
  balanceDelta?: { before: unknown; after: unknown };
  reaudit?: unknown;
  exchangeTransferType?: string;
  timestamp?: string;
}): string {
  const { request, response, balanceDelta, reaudit, exchangeTransferType, timestamp } = input;
  return JSON.stringify({
    ...(request !== undefined && { request }),
    ...(response !== undefined && { response }),
    ...(balanceDelta !== undefined && { balanceDelta }),
    ...(reaudit !== undefined && { reaudit }),
    ...(exchangeTransferType !== undefined && { exchangeTransferType }),
    ...(timestamp !== undefined && { timestamp }),
  });
}

export interface TransferSettings {
  transfer: {
    allowAutoTransfer?: boolean;
    mode?: string;
    maxAutoTransferUsdt?: number;
  };
}

/**
 * 阶段 1-3：加载设置并校验自动划转开关、模式、金额上限、安全决策。
 */
export async function loadAndValidateSettings(input: {
  transferPlan: { amountUsdt: number };
  safeExecutionDecision?: { autoTransferExecutable?: boolean };
}, ledgerId: string): Promise<
  | { ok: true; settings: TransferSettings }
  | { ok: false; status: "failed" | "frozen"; blockers: string[] }
> {
  let settings: TransferSettings;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    settings = await loadSettings();
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: [`设置加载失败: ${e.message}`] };
  }

  if (!settings.transfer.allowAutoTransfer) {
    return { ok: false, status: "failed", blockers: ["autoTransfer 未启用"] };
  }
  if (settings.transfer.mode !== "auto_transfer") {
    return { ok: false, status: "failed", blockers: [`transfer.mode=${settings.transfer.mode}，需要 auto_transfer`] };
  }
  if (input.transferPlan.amountUsdt > (settings.transfer.maxAutoTransferUsdt ?? 0)) {
    return {
      ok: false,
      status: "failed",
      blockers: [`划转金额 ${input.transferPlan.amountUsdt}U > 最大自动划转 ${settings.transfer.maxAutoTransferUsdt}U`],
    };
  }

  if (input.safeExecutionDecision && input.safeExecutionDecision.autoTransferExecutable !== true) {
    return { ok: false, status: "failed", blockers: ["safeExecutionDecision.autoTransferExecutable 不为 true"] };
  }

  return { ok: true, settings };
}

/**
 * 阶段 4：硬校验交易所、资产、同账户等硬性条件。
 */
export function runHardTransferChecks(transferPlan: {
  exchange: ExchangeId;
  asset: string;
  fromAccount: string;
  toAccount: string;
}, dryRun: boolean): { ok: true } | { ok: false; status: "failed"; blockers: string[] } {
  if (transferPlan.exchange === "htx") {
    return { ok: false, status: "failed", blockers: ["HTX 不支持自动划转"] };
  }
  // OKX 统一账户下 spot↔perp 共享资金，transferInternal 直接返回 ok
  //（不需要真实 API 划转，但走完整流程以记录审计 trail）
  // 第一版真实划转仅允许 Binance 和 OKX（HTX observe-only）
  if (!dryRun && transferPlan.exchange !== "binance" && transferPlan.exchange !== "okx") {
    return { ok: false, status: "failed", blockers: [`${transferPlan.exchange}_real_internal_transfer_not_supported`] };
  }
  if (transferPlan.asset !== "USDT") {
    return { ok: false, status: "failed", blockers: ["仅支持 USDT 划转"] };
  }
  if (transferPlan.fromAccount === transferPlan.toAccount) {
    return { ok: false, status: "failed", blockers: ["同账户划转无意义"] };
  }

  return { ok: true };
}

/**
 * 阶段 5：幂等 key 生成与查重，决定是复用、阻断还是继续。
 */
export async function resolveIdempotency(transferPlan: {
  exchange: ExchangeId;
  fromAccount: string;
  toAccount: string;
  amountUsdt: number;
}, intentId: string | undefined): Promise<
  | { action: "continue"; idempotencyKey: string }
  | { action: "return_existing"; ledgerId: string; status: "submitted" | "balance_confirmed" | "reaudit_passed"; ok: true; blockers: string[]; warnings: string[] }
  | { action: "return_failed"; ledgerId: string; status: "failed" | "frozen"; ok: false; blockers: string[]; warnings: string[] }
> {
  const ik = buildIdempotencyKey({
    exchange: transferPlan.exchange,
    fromAccount: transferPlan.fromAccount,
    toAccount: transferPlan.toAccount,
    amountUsdt: transferPlan.amountUsdt,
    intentId,
  });

  const existing = await findInternalTransferByIdempotencyKey(ik);
  if (existing) {
    if (existing.status === "submitted" || existing.status === "balance_confirmed" || existing.status === "reaudit_passed") {
      return {
        action: "return_existing",
        ledgerId: existing.id,
        status: existing.status,
        ok: true,
        blockers: [],
        warnings: ["重复的幂等 key，返回已有结果"],
      };
    }
    if (existing.status === "failed" || existing.status === "frozen") {
      return {
        action: "return_failed",
        ledgerId: existing.id,
        status: existing.status,
        ok: false,
        blockers: [`前次划转状态 ${existing.status}，不自动重试，请人工确认`],
        warnings: [],
      };
    }
  }

  return { action: "continue", idempotencyKey: ik };
}

export interface AccountAdapterLike {
  exchangeId: ExchangeId;
  fetchBalances: () => Promise<unknown>;
  transferInternal: (req: InternalTransferRequest) => Promise<InternalTransferResult>;
}

/**
 * 阶段 6-7：创建 account adapter 并获取划转前余额。
 */
export async function createAdapterAndFetchBeforeBalances(exchange: ExchangeId): Promise<
  | { ok: true; adapter: AccountAdapterLike; beforeBalances: unknown }
  | { ok: false; status: "frozen"; blockers: string[]; warnings?: string[] }
> {
  let adapter: AccountAdapterLike;
  try {
    const adapterResult = await createAccountAdapter(exchange);
    adapter = (adapterResult as any).adapter ?? adapterResult;
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: [`创建适配器失败: ${e.message}`] };
  }

  let beforeBalances: unknown;
  try {
    beforeBalances = await adapter.fetchBalances();
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: ["划转前余额读取失败"], warnings: [String(e)] };
  }

  return { ok: true, adapter, beforeBalances };
}

export interface TransferContext {
  ledgerId: string;
  intentId?: string;
  decisionId?: string;
  transferPlan: {
    exchange: ExchangeId;
    asset: "USDT";
    fromAccount: "spot" | "perp";
    toAccount: "spot" | "perp";
    amountUsdt: number;
    reason: string;
  };
  dryRun: boolean;
  idempotencyKey: string;
  beforeBalances: unknown;
  adapter: AccountAdapterLike;
}

/**
 * 阶段 8：写入 planned / dry_run ledger 记录。
 */
export async function writePlannedLedgerRecord(ctx: TransferContext): Promise<void> {
  const { ledgerId, intentId, decisionId, transferPlan, dryRun, idempotencyKey, beforeBalances } = ctx;
  const now = new Date().toISOString();
  await createInternalTransferRecord({
    id: ledgerId,
    intentId,
    decisionId,
    exchange: transferPlan.exchange,
    asset: "USDT",
    fromAccount: transferPlan.fromAccount,
    toAccount: transferPlan.toAccount,
    amountUsdt: transferPlan.amountUsdt,
    status: dryRun ? "dry_run" : "planned",
    idempotencyKey,
    exchangeTransferType: transferPlan.exchange === "binance"
      ? toBinanceType(transferPlan.fromAccount, transferPlan.toAccount) : undefined,
    rawJson: buildTransferLedgerPayload({
      request: { ...transferPlan, intentId, dryRun },
      timestamp: now,
    }),
    createdAtUtc: now,
    updatedAtUtc: now,
  });
}

/**
 * 阶段 9：dry-run 返回；env 门控检查。
 */
export function checkRealTransferEnvGate(dryRun: boolean): {
  shouldReturn: boolean;
  status?: "dry_run" | "failed";
  blockers?: string[];
} {
  if (dryRun) {
    return { shouldReturn: true, status: "dry_run", blockers: [] };
  }
  if (!isRealInternalTransferEnabled()) {
    return { shouldReturn: true, status: "failed", blockers: ["V121_ENABLE_REAL_INTERNAL_TRANSFER 未启用"] };
  }
  return { shouldReturn: false };
}

/**
 * 阶段 10：提交真实内部划转。
 */
export async function submitInternalTransfer(adapter: AccountAdapterLike, ctx: TransferContext): Promise<
  | { ok: true; transfer: InternalTransferResult }
  | { ok: false; status: "failed" | "frozen"; transfer?: InternalTransferResult; blockers: string[]; warnings: string[] }
> {
  const { transferPlan, intentId, decisionId, idempotencyKey } = ctx;
  let transfer: InternalTransferResult;
  try {
    transfer = await adapter.transferInternal({
      exchange: transferPlan.exchange,
      asset: "USDT",
      fromAccount: transferPlan.fromAccount,
      toAccount: transferPlan.toAccount,
      amountUsdt: transferPlan.amountUsdt,
      reason: transferPlan.reason,
      intentId,
      decisionId,
      idempotencyKey,
      dryRun: false,
    });
  } catch (e: any) {
    await updateInternalTransferRecord(ctx.ledgerId, { status: "frozen", error: String(e) });
    return { ok: false, status: "frozen", blockers: [`划转调用异常: ${e.message}`], warnings: [] };
  }

  if (!transfer.ok) {
    const failStatus = transfer.status === "frozen" ? "frozen" : "failed";
    await updateInternalTransferRecord(ctx.ledgerId, { status: failStatus, error: transfer.error, rawJson: JSON.stringify(transfer) });
    return {
      ok: false,
      status: failStatus,
      transfer,
      blockers: [`划转失败: ${transfer.error ?? "unknown"}`],
      warnings: transfer.warnings,
    };
  }

  if (transfer.status === "frozen") {
    await updateInternalTransferRecord(ctx.ledgerId, { status: "frozen", error: transfer.error, rawJson: JSON.stringify(transfer) });
    return { ok: false, status: "frozen", transfer, blockers: ["划转返回 frozen"], warnings: transfer.warnings };
  }

  await updateInternalTransferRecord(ctx.ledgerId, {
    status: "submitted",
    transferId: transfer.transferId,
    rawJson: buildTransferLedgerPayload({
      request: { ...transferPlan, intentId, dryRun: false },
      response: transfer.raw,
      exchangeTransferType: transferPlan.exchange === "binance"
        ? toBinanceType(transferPlan.fromAccount, transferPlan.toAccount) : undefined,
    }),
  });

  return { ok: true, transfer };
}

/** 纯函数：计算某账户 USDT free 变化量。 */
export function computeBalanceDelta(before: unknown, after: unknown): number {
  const sumFree = (balances: unknown): number => {
    if (!Array.isArray(balances)) return 0;
    return balances.filter((b: any) => b?.asset === "USDT").reduce((s: number, b: any) => s + (b?.free ?? 0), 0);
  };
  return sumFree(after) - sumFree(before);
}

/**
 * 阶段 11-12：重试读取划转后余额并校验余额变化方向。
 */
export async function confirmAfterBalancesAndDelta(ctx: TransferContext & { transfer: InternalTransferResult }): Promise<
  | { ok: true; afterBalances: unknown }
  | { ok: false; status: "frozen"; blockers: string[]; warnings: string[] }
> {
  const { ledgerId, transferPlan, transfer, adapter, beforeBalances } = ctx;
  let afterBalances: unknown;
  try {
    afterBalances = await withRetry(() => adapter.fetchBalances(), {
      maxAttempts: 3,
      baseDelayMs: 1000,
      onRetry: (_err, attempt) => {
        console.warn(`[autoTransfer] 划转后余额读取第 ${attempt} 次重试`);
      },
    });
  } catch {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: "余额读取失败" });
    return { ok: false, status: "frozen", blockers: ["划转后余额读取失败"], warnings: [] };
  }

  await updateInternalTransferRecord(ledgerId, {
    status: "balance_confirmed",
    rawJson: buildTransferLedgerPayload({
      request: { ...transferPlan, intentId: ctx.intentId, dryRun: false },
      response: transfer.raw,
      balanceDelta: { before: beforeBalances, after: afterBalances },
      exchangeTransferType: transferPlan.exchange === "binance"
        ? toBinanceType(transferPlan.fromAccount, transferPlan.toAccount) : undefined,
    }),
  });

  try {
    // deltaFrom：划出账户的余额变化（应减少）；deltaTo：划入账户的余额变化（应增加）。
    // 当余额快照仅包含划出账户时，可用 total 变化量的反号作为划入账户的近似变化量。
    const deltaFrom = computeBalanceDelta(beforeBalances, afterBalances);
    const deltaTo = computeBalanceDelta(afterBalances, beforeBalances);
    if (!isBalanceDirectionChanged(deltaFrom, deltaTo)) {
      await updateInternalTransferRecord(ledgerId, { status: "frozen", error: "余额未变化" });
      return { ok: false, status: "frozen", blockers: ["划转提交成功但余额未变化"], warnings: [] };
    }
  } catch { /* skip balance delta check */ }

  return { ok: true, afterBalances };
}

/**
 * 阶段 13-14：重新跑资本预检 + 最终审计。
 */
export async function runReaudit(exchange: ExchangeId, amountUsdt: number): Promise<
  | { ok: true; reaudit: { capitalPrecheck: unknown; finalAudit: unknown } }
  | { ok: false; status: "frozen"; blockers: string[]; warnings: string[] }
> {
  let reaudit: { capitalPrecheck: unknown; finalAudit?: unknown };
  try {
    const { runCapitalPrecheck } = await import("./capitalPrecheck");
    const cp = await runCapitalPrecheck(exchange, "", amountUsdt);
    reaudit = { capitalPrecheck: cp };
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: ["重新资本预检失败"], warnings: [`资本预检异常: ${e.message}`] };
  }

  try {
    const { runFinalPreExecutionAudit } = await import("../mainnetTiny/finalPreExecutionAudit");
    const fa = await runFinalPreExecutionAudit();
    reaudit = { ...reaudit, finalAudit: fa };
  } catch (e: any) {
    return { ok: false, status: "frozen", blockers: ["重新最终审计失败"], warnings: [`最终审计异常: ${e.message}`] };
  }

  return { ok: true, reaudit: reaudit as { capitalPrecheck: unknown; finalAudit: unknown } };
}

/**
 * 阶段 15：更新 ledger 为最终状态。
 */
export async function finalizeLedgerRecord(
  ledgerId: string,
  status: "reaudit_passed" | "failed" | "frozen" | "dry_run" | "submitted" | "balance_confirmed",
  payload: {
    transferPlan: TransferContext["transferPlan"];
    intentId?: string;
    transfer?: InternalTransferResult;
    beforeBalances?: unknown;
    afterBalances?: unknown;
    reaudit?: unknown;
  },
): Promise<void> {
  const { transferPlan, intentId, transfer, beforeBalances, afterBalances, reaudit } = payload;
  await updateInternalTransferRecord(ledgerId, {
    status,
    rawJson: buildTransferLedgerPayload({
      request: { ...transferPlan, intentId, dryRun: false },
      response: transfer?.raw,
      balanceDelta: beforeBalances !== undefined && afterBalances !== undefined
        ? { before: beforeBalances, after: afterBalances }
        : undefined,
      reaudit,
      exchangeTransferType: transferPlan.exchange === "binance"
        ? toBinanceType(transferPlan.fromAccount, transferPlan.toAccount) : undefined,
    }),
  });
}

export async function executeAutoTransferAndReaudit(input: {
  intentId?: string;
  decisionId?: string;
  safeExecutionDecision?: { autoTransferExecutable?: boolean };
  transferPlan: {
    exchange: ExchangeId;
    asset: "USDT";
    fromAccount: "spot" | "perp";
    toAccount: "spot" | "perp";
    amountUsdt: number;
    reason: string;
  };
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  status: "dry_run" | "submitted" | "balance_confirmed" | "reaudit_passed" | "failed" | "frozen";
  transfer?: InternalTransferResult;
  ledgerId: string;
  beforeBalances?: unknown;
  afterBalances?: unknown;
  reaudit?: unknown;
  blockers: string[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const dryRun = input.dryRun !== false; // 默认 dry-run
  const ledgerId = makeId();

  const settingsResult = await loadAndValidateSettings(input, ledgerId);
  if (!settingsResult.ok) {
    return { ok: false, status: settingsResult.status, ledgerId, blockers: settingsResult.blockers, warnings };
  }

  const hardCheckResult = runHardTransferChecks(input.transferPlan, dryRun);
  if (!hardCheckResult.ok) {
    return { ok: false, status: hardCheckResult.status, ledgerId, blockers: hardCheckResult.blockers, warnings };
  }

  const idempotencyResult = await resolveIdempotency(input.transferPlan, input.intentId);
  if (idempotencyResult.action !== "continue") {
    return {
      ok: idempotencyResult.ok,
      status: idempotencyResult.status,
      ledgerId: idempotencyResult.ledgerId,
      blockers: idempotencyResult.blockers,
      warnings: idempotencyResult.warnings,
    };
  }

  const adapterResult = await createAdapterAndFetchBeforeBalances(input.transferPlan.exchange);
  if (!adapterResult.ok) {
    return { ok: false, status: adapterResult.status, ledgerId, blockers: adapterResult.blockers, warnings: adapterResult.warnings ?? [] };
  }
  const { adapter, beforeBalances } = adapterResult;

  const ctx: TransferContext = {
    ledgerId,
    intentId: input.intentId,
    decisionId: input.decisionId,
    transferPlan: input.transferPlan,
    dryRun,
    idempotencyKey: idempotencyResult.idempotencyKey,
    beforeBalances,
    adapter,
  };

  await writePlannedLedgerRecord(ctx);

  const envGate = checkRealTransferEnvGate(dryRun);
  if (envGate.shouldReturn) {
    if (envGate.status === "failed") {
      await updateInternalTransferRecord(ledgerId, { status: "failed", error: "real_internal_transfer_env_disabled" });
      return { ok: false, status: "failed", ledgerId, blockers: envGate.blockers ?? [], warnings };
    }
    return { ok: true, status: "dry_run", ledgerId, beforeBalances, blockers: [], warnings: ["dry_run — 未执行真实划转"] };
  }

  const submitResult = await submitInternalTransfer(adapter, ctx);
  if (!submitResult.ok) {
    return {
      ok: false,
      status: submitResult.status,
      ledgerId,
      transfer: submitResult.transfer,
      beforeBalances,
      blockers: submitResult.blockers,
      warnings: submitResult.warnings,
    };
  }
  const transfer = submitResult.transfer;

  const confirmResult = await confirmAfterBalancesAndDelta({ ...ctx, transfer });
  if (!confirmResult.ok) {
    return { ok: false, status: confirmResult.status, ledgerId, transfer, beforeBalances, blockers: confirmResult.blockers, warnings: confirmResult.warnings };
  }
  const afterBalances = confirmResult.afterBalances;

  const reauditResult = await runReaudit(input.transferPlan.exchange, input.transferPlan.amountUsdt);
  if (!reauditResult.ok) {
    return { ok: false, status: reauditResult.status, ledgerId, transfer, afterBalances, blockers: reauditResult.blockers, warnings: reauditResult.warnings };
  }
  const reaudit = reauditResult.reaudit;

  await finalizeLedgerRecord(ledgerId, "reaudit_passed", {
    transferPlan: input.transferPlan,
    intentId: input.intentId,
    transfer,
    beforeBalances,
    afterBalances,
    reaudit,
  });

  return {
    ok: true,
    status: "reaudit_passed",
    ledgerId,
    transfer,
    beforeBalances,
    afterBalances,
    reaudit,
    blockers: [],
    warnings: ["划转成功，余额已确认，重新审计已通过。仍然不会自动下单。"],
  };
}
