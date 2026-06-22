"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 开仓页 — 把一次开仓拆成 6 步线性流程，普通用户按顺序点即可。
 *
 * ① 选择可执行机会   ② 准备资金（可选）  ③ 生成开仓方案
 * ④ 交易所参数校验   ⑤ 执行前校验        ⑥ 确认开仓
 *
 * 确认串映射（用户看到的是产品词，发给后端的是工程确认串）：
 *   用户输入 CONFIRM_OPEN_POSITION  → 后端 EXECUTE_REAL_TWO_LEG_ORDER
 *   用户输入 CONFIRM_TRANSFER       → 后端 EXECUTE_REAL_INTERNAL_TRANSFER
 * 工程确认串只出现在 fetch body 中，绝不渲染到界面。
 *
 * 后端安全机制（preflight / safeExecution / 11-gate / kill switch / freeze）
 * 完全保留不变，本页只是把这些步骤用产品语言重新包装。
 */

// ── 用户可见的确认串（产品词）──────────────────────────────
const USER_CONFIRM_OPEN = "CONFIRM_OPEN_POSITION";
const USER_CONFIRM_TRANSFER = "CONFIRM_TRANSFER";

// ── 后端确认串（工程词，仅用于 fetch body，不渲染）─────────
const BACKEND_CONFIRM_OPEN = "EXECUTE_REAL_TWO_LEG_ORDER";
const BACKEND_CONFIRM_TRANSFER = "EXECUTE_REAL_INTERNAL_TRANSFER";

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

/** 把后端状态码翻译成用户语言。 */
function translateStatus(status: string | undefined): { text: string; tone: "green" | "red" | "slate" } {
  switch (status) {
    case "dry_run":
      return { text: "校验通过", tone: "green" };
    case "filled":
      return { text: "开仓成功", tone: "green" };
    case "frozen":
      return { text: "已暂停保护", tone: "red" };
    case "blocked":
      return { text: "暂不可执行", tone: "red" };
    case "validated":
      return { text: "校验通过", tone: "green" };
    default:
      return { text: status ?? "—", tone: "slate" };
  }
}

interface Intent {
  id?: string;
  intentId?: string;
  symbol?: string;
  spotExchange?: string;
  perpExchange?: string;
  plannedNotionalUsdt?: number;
  purpose?: string;
  simulationOnly?: unknown;
  realTradeEligible?: unknown;
}

export default function TradeOpenPage() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);

  // Step ③ 生成开仓方案
  const [orderPlanResult, setOrderPlanResult] = useState<any>(null);
  const [orderPlanLoading, setOrderPlanLoading] = useState(false);

  // Step ④ 交易所参数校验
  const [spotTestResult, setSpotTestResult] = useState<any>(null);
  const [spotTestLoading, setSpotTestLoading] = useState(false);

  // Step ⑤ 执行前校验（dry-run）
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  // Step ⑥ 确认开仓（真实下单）
  const [realExecResult, setRealExecResult] = useState<any>(null);
  const [realExecLoading, setRealExecLoading] = useState(false);

  // Step ② 准备资金（可选）
  const [transferResult, setTransferResult] = useState<any>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferSkipped, setTransferSkipped] = useState(false);

  const fetchAll = () => {
    fetch("/api/v121/mainnet-tiny/intents").then((r) => r.json()).then((d) => setIntents(d.intents ?? [])).catch(() => {});
    fetch("/api/v121/settings").then((r) => r.json()).then((d) => setSettings(d.settings ?? d)).catch(() => {});
  };

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 10000);
    return () => clearInterval(i);
  }, []);

  // ① 可执行机会：purpose=real_arbitrage & !simulationOnly & realTradeEligible=true
  const eligible = intents.filter(
    (i) => i.purpose === "real_arbitrage" && !toBool(i.simulationOnly) && toBool(i.realTradeEligible),
  );
  const selectedIntent = eligible.find((i) => (i.id ?? i.intentId) === selectedIntentId) ?? null;

  // ③ 开仓方案
  const planValidated =
    orderPlanResult?.ok === true &&
    orderPlanResult?.orderPlan?.status === "validated" &&
    orderPlanResult?.orderPlan?.spotLeg &&
    orderPlanResult?.orderPlan?.perpLeg;
  const orderPlanId = orderPlanResult?.orderPlan?.id;

  // ④ 交易所参数校验
  const spotTestPassed = spotTestResult?.ok === true;

  // ⑤ 执行前校验
  const dryRunPassed = dryRunResult?.status === "dry_run";

  // ⑥ 真实开仓
  const realOpenDone = realExecResult?.status === "filled";

  // 各步是否就绪
  const step1Done = selectedIntent != null;
  const step2Done = transferSkipped || transferResult?.ok === true;
  const step3Done = planValidated;
  const step4Done = spotTestPassed;
  const step5Done = dryRunPassed;

  // ── Step ③ 生成开仓方案 ─────────────────────────────────
  const generateOrderPlan = async () => {
    if (!selectedIntent) return;
    setOrderPlanLoading(true);
    setOrderPlanResult(null);
    setSpotTestResult(null);
    setDryRunResult(null);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/order-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: selectedIntent.intentId ?? selectedIntent.id,
          exchange: "binance",
          symbol: selectedIntent.symbol,
          plannedNotionalUsdt: Number(settings?.notional?.plannedNotionalUsdt ?? 10),
        }),
      });
      const d = await r.json();
      setOrderPlanResult(d);
    } finally {
      setOrderPlanLoading(false);
    }
  };

  // ── Step ④ 交易所参数校验 ───────────────────────────────
  const runSpotTest = async () => {
    if (!orderPlanId) return;
    setSpotTestLoading(true);
    setSpotTestResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/order-plan/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderPlanId }),
      });
      setSpotTestResult(await r.json());
    } finally {
      setSpotTestLoading(false);
    }
  };

  // ── Step ⑤ 执行前校验（dry-run）────────────────────────
  const runDryRun = async () => {
    if (!orderPlanId) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/order-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderPlanId, dryRun: true }),
      });
      setDryRunResult(await r.json());
    } finally {
      setDryRunLoading(false);
    }
  };

  // ── Step ⑥ 确认开仓（真实下单）─────────────────────────
  const runRealOpen = async () => {
    if (!orderPlanId || !dryRunPassed) return;
    // 用户输入产品词 CONFIRM_OPEN_POSITION；映射成后端确认串再发送。
    const phrase = window.prompt(`请输入 ${USER_CONFIRM_OPEN} 以确认开仓。确认后将向交易所真实下单。`);
    if (phrase !== USER_CONFIRM_OPEN) return;
    setRealExecLoading(true);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/order-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderPlanId, dryRun: false, explicitConfirm: BACKEND_CONFIRM_OPEN }),
      });
      setRealExecResult(await r.json());
    } finally {
      setRealExecLoading(false);
    }
  };

  // ── Step ② 准备资金（可选，dry-run 划转）────────────────
  // 注意：自动划转方案需要后端 orchestrator 提供，本系统当前未启用自动划转。
  // 此步仅在校验已有划转方案时使用；如资金已就位可直接跳过。
  const skipTransfer = () => {
    setTransferSkipped(true);
    setTransferResult(null);
  };

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold">开仓</h2>
      <p className="mb-6 text-sm text-gray-400">
        按以下 6 步完成一次开仓。每步通过后才能进入下一步，最后一步需要二次确认才会真实下单。
      </p>

      {/* 步骤指示 */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        {[
          { n: 1, label: "选择可执行机会", done: step1Done },
          { n: 2, label: "准备资金（可选）", done: step2Done },
          { n: 3, label: "生成开仓方案", done: step3Done },
          { n: 4, label: "交易所参数校验", done: step4Done },
          { n: 5, label: "执行前校验", done: step5Done },
          { n: 6, label: "确认开仓", done: realOpenDone },
        ].map((s) => (
          <span
            key={s.n}
            className={`rounded border px-2 py-1 ${
              s.done
                ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
                : "border-gray-700 bg-gray-800/60 text-gray-400"
            }`}
          >
            {s.n}. {s.label}
          </span>
        ))}
      </div>

      {/* ① 选择可执行机会 */}
      <StepSection
        n={1}
        title="选择可执行机会"
        tone="cyan"
        done={step1Done}
      >
        {eligible.length === 0 ? (
          <div className="text-sm text-amber-300">
            暂无可执行机会。可前往
            <Link href="/opportunities" className="mx-1 underline hover:text-amber-100">机会页</Link>
            查看当前机会状态，或等待系统扫描。
          </div>
        ) : (
          <div className="space-y-1">
            {eligible.slice(0, 10).map((i) => {
              const id = i.id ?? i.intentId ?? "";
              const active = id === selectedIntentId;
              return (
                <label
                  key={id}
                  className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${
                    active
                      ? "border-cyan-500/60 bg-cyan-500/10"
                      : "border-gray-800 bg-gray-900 hover:border-gray-700"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="intent"
                      checked={active}
                      onChange={() => {
                        setSelectedIntentId(id);
                        // 切换机会时清空后续步骤
                        setOrderPlanResult(null);
                        setSpotTestResult(null);
                        setDryRunResult(null);
                        setRealExecResult(null);
                        setTransferResult(null);
                        setTransferSkipped(false);
                      }}
                      className="accent-cyan-400"
                    />
                    <span className="font-semibold">{i.symbol}</span>
                    <span className="text-gray-400">{i.spotExchange} → {i.perpExchange}</span>
                  </span>
                  <span className="font-mono text-xs text-gray-300">${fmtNum(i.plannedNotionalUsdt, 2)}</span>
                </label>
              );
            })}
            <div className="text-xs text-gray-500">共 {eligible.length} 个可执行机会</div>
          </div>
        )}
      </StepSection>

      {/* ② 准备资金（可选）*/}
      <StepSection
        n={2}
        title="准备资金（可选）"
        tone="amber"
        done={step2Done}
        disabled={!step1Done}
      >
        <div className="mb-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">划转模式</span>
            <span className="font-mono">{settings?.transfer?.mode ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">最大自动划转</span>
            <span className="font-mono">${fmtNum(settings?.transfer?.maxAutoTransferUsdt)} USDT</span>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          如账户资金已就位，可直接跳过此步。本系统当前未启用自动生成划转方案；如需划转请通过其它方式完成。
        </p>
        <div className="flex gap-2">
          <button
            onClick={skipTransfer}
            disabled={!step1Done || transferSkipped}
            className="border border-gray-600 bg-gray-800/60 px-3 py-1.5 text-sm text-gray-200 rounded disabled:opacity-30"
          >
            {transferSkipped ? "已跳过" : "跳过此步"}
          </button>
        </div>
        {transferResult ? (
          <ResultBox ok={transferResult.ok === true}>
            <div>{transferResult.status}{transferResult.blockers?.length ? `: ${transferResult.blockers.join(", ")}` : ""}</div>
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ③ 生成开仓方案 */}
      <StepSection
        n={3}
        title="生成开仓方案"
        tone="purple"
        done={step3Done}
        disabled={!step1Done}
      >
        <div className="mb-3">
          <button
            onClick={generateOrderPlan}
            disabled={!step1Done || orderPlanLoading}
            className="border border-purple-500/60 bg-purple-500/15 px-3 py-1.5 text-sm text-purple-200 rounded disabled:opacity-30"
          >
            {orderPlanLoading ? "生成中..." : "生成开仓方案"}
          </button>
        </div>
        {orderPlanResult ? (
          <ResultBox ok={orderPlanResult.ok === true}>
            <div className={orderPlanResult.ok ? "text-emerald-400" : "text-red-400"}>
              {orderPlanResult.ok ? "✓ 开仓方案已生成" : `⛔ ${orderPlanResult.status ?? "生成失败"}`}
            </div>
            {orderPlanResult.orderPlan?.spotLeg ? (
              <div className="text-gray-400">
                现货：{fmtNum(orderPlanResult.orderPlan.spotLeg.quantity, 6)} @ ${fmtNum(orderPlanResult.orderPlan.spotLeg.estimatedPrice)} = ${fmtNum(orderPlanResult.orderPlan.spotLeg.quoteNotionalUsdt)}
              </div>
            ) : null}
            {orderPlanResult.orderPlan?.perpLeg ? (
              <div className="text-gray-400">
                合约：{fmtNum(orderPlanResult.orderPlan.perpLeg.quantity, 6)} @ ${fmtNum(orderPlanResult.orderPlan.perpLeg.estimatedPrice)} = ${fmtNum(orderPlanResult.orderPlan.perpLeg.quoteNotionalUsdt)}
              </div>
            ) : null}
            {orderPlanResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{orderPlanResult.blockers.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ④ 交易所参数校验 */}
      <StepSection
        n={4}
        title="交易所参数校验"
        tone="cyan"
        done={step4Done}
        disabled={!step3Done}
      >
        <div className="mb-3">
          <button
            onClick={runSpotTest}
            disabled={!step3Done || spotTestLoading}
            className="border border-cyan-500/60 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-200 rounded disabled:opacity-30"
          >
            {spotTestLoading ? "校验中..." : "开始校验"}
          </button>
        </div>
        {spotTestResult ? (
          <ResultBox ok={spotTestResult.ok === true}>
            <div className={spotTestResult.ok ? "text-emerald-400" : "text-red-400"}>
              {spotTestResult.ok ? "✓ 交易所参数校验通过" : "⛔ 校验未通过"}
            </div>
            {spotTestResult.blockers?.length > 0 ? (
              <div className="text-red-400">{spotTestResult.blockers.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ⑤ 执行前校验 */}
      <StepSection
        n={5}
        title="执行前校验"
        tone="amber"
        done={step5Done}
        disabled={!step4Done}
      >
        <p className="mb-3 text-xs text-gray-500">
          系统将模拟一次下单，校验所有安全检查是否通过。通过后才能进入确认开仓。
        </p>
        <div className="mb-3">
          <button
            onClick={runDryRun}
            disabled={!step4Done || dryRunLoading}
            className="border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 rounded disabled:opacity-30"
          >
            {dryRunLoading ? "校验中..." : "执行前校验"}
          </button>
        </div>
        {dryRunResult ? (
          <ResultBox ok={dryRunPassed}>
            <div className={dryRunPassed ? "text-emerald-400" : "text-red-400"}>
              {dryRunPassed
                ? "✓ 执行前校验通过，可进入确认开仓"
                : `⛔ ${translateStatus(dryRunResult.status).text}${dryRunResult.frozenReason ? `：${dryRunResult.frozenReason}` : ""}`}
            </div>
            {dryRunResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{dryRunResult.blockers.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ⑥ 确认开仓 */}
      <StepSection
        n={6}
        title="确认开仓"
        tone="red"
        done={realOpenDone}
        disabled={!step5Done}
      >
        <p className="mb-3 text-xs text-gray-500">
          点击后将弹出确认框，需要输入 <code className="rounded bg-gray-800 px-1 text-cyan-300">{USER_CONFIRM_OPEN}</code> 才会真实下单。
        </p>
        <div className="mb-3">
          <button
            onClick={runRealOpen}
            disabled={!step5Done || realExecLoading || realOpenDone}
            className="border border-red-500/60 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 rounded disabled:opacity-30"
          >
            {realExecLoading ? "下单中..." : realOpenDone ? "已开仓" : "确认开仓"}
          </button>
        </div>
        {realExecResult ? (
          <ResultBox ok={realOpenDone}>
            <div className={realOpenDone ? "text-emerald-400" : "text-red-400"}>
              {realOpenDone
                ? "✓ 开仓成功"
                : `⛔ ${translateStatus(realExecResult.status).text}${realExecResult.frozenReason ? `：${realExecResult.frozenReason}` : ""}`}
            </div>
            {realExecResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{realExecResult.blockers.join(", ")}</div>
            ) : null}
            {realExecResult.spot ? <div className="text-gray-400">现货腿：{realExecResult.spot.status}</div> : null}
            {realExecResult.perp ? <div className="text-gray-400">合约腿：{realExecResult.perp.status}</div> : null}
          </ResultBox>
        ) : null}
        {realOpenDone ? (
          <div className="mt-3 text-sm text-emerald-200">
            开仓已完成，可前往
            <Link href="/positions" className="mx-1 underline hover:text-emerald-100">持仓页</Link>
            查看持仓。
          </div>
        ) : null}
      </StepSection>
    </div>
  );
}

// ── UI 子组件 ─────────────────────────────────────────────

function StepSection({
  n,
  title,
  tone,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  tone: "cyan" | "amber" | "purple" | "red";
  done: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const toneClass = {
    cyan: "text-cyan-400 border-cyan-800/40",
    amber: "text-amber-400 border-amber-800/40",
    purple: "text-purple-400 border-purple-800/40",
    red: "text-red-400 border-red-800/40",
  }[tone];
  return (
    <section
      className={`mb-4 rounded-lg border bg-gray-900 p-4 ${
        disabled ? "border-gray-800 opacity-50" : "border-gray-800"
      }`}
    >
      <h3 className={`mb-3 flex items-center gap-2 text-lg font-semibold ${toneClass}`}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs">
          {done ? "✓" : n}
        </span>
        {title}
      </h3>
      {disabled ? (
        <p className="text-xs text-gray-500">请先完成上一步。</p>
      ) : (
        children
      )}
    </section>
  );
}

function ResultBox({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`mt-2 space-y-1 rounded p-2 text-xs font-mono ${
        ok ? "bg-emerald-950/30" : "bg-gray-800"
      }`}
    >
      {children}
    </div>
  );
}
