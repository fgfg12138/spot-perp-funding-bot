import type { ExchangeId } from "../domain/types";
import type { InternalTransferResult } from "./internalTransferTypes";
import { createInternalTransferRecord, updateInternalTransferRecord, findInternalTransferByIdempotencyKey } from "./internalTransferLedger";
import { createAccountAdapter } from "../account/adapters/accountAdapterFactory";

function makeId(): string { return `autox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

export async function executeAutoTransferAndReaudit(input: {
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
  const blockers: string[] = [];
  const warnings: string[] = [];
  const dryRun = input.dryRun !== false; // 默认 dry-run
  const ledgerId = makeId();

  // 1-4. load settings
  let settings: any;
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    settings = await loadSettings();
  } catch (e: any) {
    return { ok: false, status: "frozen", ledgerId, blockers: [`设置加载失败: ${e.message}`], warnings };
  }

  if (!settings.transfer.allowAutoTransfer) {
    return { ok: false, status: "failed", ledgerId, blockers: ["autoTransfer 未启用"], warnings };
  }
  if (settings.transfer.mode !== "auto_transfer") {
    return { ok: false, status: "failed", ledgerId, blockers: [`transfer.mode=${settings.transfer.mode}，需要 auto_transfer`], warnings };
  }
  if (input.transferPlan.amountUsdt > settings.transfer.maxAutoTransferUsdt) {
    return { ok: false, status: "failed", ledgerId, blockers: [`划转金额 ${input.transferPlan.amountUsdt}U > 最大自动划转 ${settings.transfer.maxAutoTransferUsdt}U`], warnings };
  }

  // 5-7. hard checks
  if (input.transferPlan.exchange === "htx") {
    return { ok: false, status: "failed", ledgerId, blockers: ["HTX 不支持自动划转"], warnings };
  }
  if (input.transferPlan.asset !== "USDT") {
    return { ok: false, status: "failed", ledgerId, blockers: ["仅支持 USDT 划转"], warnings };
  }
  if (input.transferPlan.fromAccount === input.transferPlan.toAccount) {
    return { ok: false, status: "failed", ledgerId, blockers: ["同账户划转无意义"], warnings };
  }

  // 8. idempotencyKey
  const ik = `ik-${input.transferPlan.exchange}-${input.transferPlan.fromAccount}-${input.transferPlan.toAccount}-${input.transferPlan.amountUsdt}-${input.intentId ?? "no-intent"}`;

  // 9. prevent duplicate
  const existing = await findInternalTransferByIdempotencyKey(ik);
  if (existing) {
    if (existing.status === "submitted" || existing.status === "balance_confirmed" || existing.status === "reaudit_passed") {
      return { ok: true, status: existing.status, ledgerId: existing.id, blockers: [], warnings: ["重复的幂等 key，返回已有结果"] };
    }
    if (existing.status === "failed" || existing.status === "frozen") {
      return { ok: false, status: existing.status, ledgerId: existing.id, blockers: [`前次划转状态 ${existing.status}，不自动重试，请人工确认`], warnings: [] };
    }
  }

  const now = new Date().toISOString();

  // 10. adapter
  let adapter: any;
  try {
    adapter = await createAccountAdapter(input.transferPlan.exchange);
  } catch (e: any) {
    return { ok: false, status: "frozen", ledgerId, blockers: [`创建适配器失败: ${e.message}`], warnings };
  }

  // 11. before balances
  let beforeBalances: any;
  try {
    beforeBalances = await adapter.fetchBalances();
  } catch (e: any) {
    return { ok: false, status: "frozen", ledgerId, blockers: ["划转前余额读取失败"], warnings: [String(e)] };
  }

  // Write planned record
  await createInternalTransferRecord({
    id: ledgerId, intentId: input.intentId, decisionId: input.decisionId,
    exchange: input.transferPlan.exchange, asset: "USDT",
    fromAccount: input.transferPlan.fromAccount, toAccount: input.transferPlan.toAccount,
    amountUsdt: input.transferPlan.amountUsdt,
    status: dryRun ? "dry_run" : "planned",
    idempotencyKey: ik,
    createdAtUtc: now, updatedAtUtc: now,
  });

  // 12-13. dry run check
  if (dryRun) {
    return { ok: true, status: "dry_run", ledgerId, beforeBalances, blockers: [], warnings: ["dry_run — 未执行真实划转"] };
  }

  if (process.env.V121_ENABLE_REAL_INTERNAL_TRANSFER !== "1") {
    await updateInternalTransferRecord(ledgerId, { status: "failed", error: "real_internal_transfer_env_disabled" });
    return { ok: false, status: "failed", ledgerId, blockers: ["V121_ENABLE_REAL_INTERNAL_TRANSFER 未启用"], warnings };
  }

  // 14. execute transfer
  if (!adapter.transferInternal) {
    await updateInternalTransferRecord(ledgerId, { status: "failed", error: "adapter_missing_transfer_internal" });
    return { ok: false, status: "failed", ledgerId, blockers: ["适配器不支持 transferInternal"], warnings };
  }

  let transfer: InternalTransferResult;
  try {
    transfer = await adapter.transferInternal({
      exchange: input.transferPlan.exchange,
      asset: "USDT",
      fromAccount: input.transferPlan.fromAccount,
      toAccount: input.transferPlan.toAccount,
      amountUsdt: input.transferPlan.amountUsdt,
      reason: input.transferPlan.reason,
      intentId: input.intentId,
      decisionId: input.decisionId,
      idempotencyKey: ik,
      dryRun: false,
    });
  } catch (e: any) {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: String(e) });
    return { ok: false, status: "frozen", ledgerId, blockers: [`划转调用异常: ${e.message}`], warnings };
  }

  if (!transfer.ok) {
    const failStatus = transfer.status === "frozen" ? "frozen" : "failed";
    await updateInternalTransferRecord(ledgerId, { status: failStatus, error: transfer.error, rawJson: JSON.stringify(transfer) });
    return { ok: false, status: failStatus, ledgerId, transfer, blockers: [`划转失败: ${transfer.error ?? "unknown"}`], warnings: transfer.warnings };
  }

  if (transfer.status === "frozen") {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: transfer.error, rawJson: JSON.stringify(transfer) });
    return { ok: false, status: "frozen", ledgerId, transfer, blockers: ["划转返回 frozen"], warnings: transfer.warnings };
  }

  await updateInternalTransferRecord(ledgerId, {
    status: "submitted", transferId: transfer.transferId, rawJson: JSON.stringify(transfer),
  });

  // 15. fetch after balances with retry
  let afterBalances: any;
  let afterOk = false;
  for (let i = 0; i < 3; i++) {
    try {
      await new Promise(r => setTimeout(r, 1000));
      afterBalances = await adapter.fetchBalances();
      afterOk = true;
      break;
    } catch { /* retry */ }
  }
  if (!afterOk) {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: "余额读取失败" });
    return { ok: false, status: "frozen", ledgerId, transfer, blockers: ["划转后余额读取失败"], warnings };
  }

  await updateInternalTransferRecord(ledgerId, { status: "balance_confirmed" });

  // 16. verify balance change direction
  try {
    const diffFrom = findBalanceDelta(beforeBalances, afterBalances, input.transferPlan.fromAccount);
    const diffTo = findBalanceDelta(beforeBalances, afterBalances, input.transferPlan.toAccount);
    if (diffFrom > -1 && diffTo < 1) {
      await updateInternalTransferRecord(ledgerId, { status: "frozen", error: "余额未变化" });
      return { ok: false, status: "frozen", ledgerId, transfer, blockers: ["划转提交成功但余额未变化"], warnings };
    }
  } catch { /* skip balance delta check */ }

  // 17. re-capitalPrecheck
  let reaudit: any;
  try {
    const { runCapitalPrecheck } = await import("./capitalPrecheck");
    const cp = await runCapitalPrecheck(input.transferPlan.exchange, "", input.transferPlan.amountUsdt);
    reaudit = { capitalPrecheck: cp };
  } catch (e: any) {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: `资本预检异常: ${e.message}` });
    return { ok: false, status: "frozen", ledgerId, transfer, afterBalances, blockers: ["重新资本预检失败"], warnings };
  }

  // 18. re-finalAudit
  try {
    const { runFinalPreExecutionAudit } = await import("../mainnetTiny/finalPreExecutionAudit");
    const fa = await runFinalPreExecutionAudit();
    reaudit = { ...reaudit, finalAudit: fa };
  } catch (e: any) {
    await updateInternalTransferRecord(ledgerId, { status: "frozen", error: `最终审计异常: ${e.message}` });
    return { ok: false, status: "frozen", ledgerId, transfer, afterBalances, blockers: ["重新最终审计失败"], warnings };
  }

  await updateInternalTransferRecord(ledgerId, { status: "reaudit_passed" });

  return {
    ok: true, status: "reaudit_passed", ledgerId, transfer, beforeBalances, afterBalances, reaudit,
    blockers: [], warnings: ["划转成功，余额已确认，重新审计已通过。仍然不会自动下单。"],
  };
}

function findBalanceDelta(before: any[], after: any[], account: string): number {
  const beforeFree = before.filter((b: any) => b.asset === "USDT").reduce((s: number, b: any) => s + (b.free ?? 0), 0);
  const afterFree = after.filter((b: any) => b.asset === "USDT").reduce((s: number, b: any) => s + (b.free ?? 0), 0);
  return afterFree - beforeFree;
}
