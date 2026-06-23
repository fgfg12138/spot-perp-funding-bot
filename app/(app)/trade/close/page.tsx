"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";

/**
 * 平仓页 — 把一次平仓拆成 5 步线性流程，普通用户按顺序点即可。
 *
 * ① 选择持仓   ② 生成平仓方案   ③ 交易所参数校验   ④ 执行前校验   ⑤ 确认平仓
 *
 * 确认串映射（用户看到的是产品词，发给后端的是工程确认串）：
 *   用户输入 CONFIRM_CLOSE_POSITION  → 后端 EXECUTE_REAL_CLOSE_POSITION
 * 工程确认串只出现在 fetch body 中，绝不渲染到界面。
 *
 * 后端安全机制（closePrecheckGate / kill switch / freeze / env gate / 确认串）
 * 完全保留不变，本页只是把这些步骤用产品语言重新包装。
 *
 * 严格边界：
 * - 仅支持币安同所平仓；OKX/HTX/跨所 → 后端 block。
 * - 平仓腿顺序由后端控制（先永续平空 → 再现货卖出），前端不干预。
 * - 任何失败/未知/部分成交 → 已暂停保护（protected），前端如实展示，不提供自动重试。
 */

// ── 用户可见的确认串（产品词）──────────────────────────────
const USER_CONFIRM_CLOSE = "CONFIRM_CLOSE_POSITION";

// ── 后端确认串（工程词，仅用于 fetch body，不渲染）─────────
const BACKEND_CONFIRM_CLOSE = "EXECUTE_REAL_CLOSE_POSITION";

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function fmtUsd(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return `${n >= 0 ? "" : "-"}$${Math.abs(n).toFixed(digits)}`;
}

/** 持仓状态翻译成用户语言。 */
function stateLabel(state: string): { text: string; tone: string } {
  switch (state) {
    case "MONITORING":
      return { text: "监控中", tone: "text-cyan-300" };
    case "OPEN":
      return { text: "持有中", tone: "text-emerald-300" };
    case "EXITING":
      return { text: "平仓中", tone: "text-amber-300" };
    case "FROZEN":
      return { text: "已暂停保护", tone: "text-red-300" };
    case "CLOSED":
      return { text: "已平仓", tone: "text-gray-400" };
    case "FAILED":
      return { text: "开仓失败", tone: "text-red-300" };
    default:
      return { text: state ?? "—", tone: "text-gray-400" };
  }
}

/** 把后端平仓状态码翻译成用户语言。 */
function translateCloseStatus(status: string | undefined): { text: string; tone: "green" | "red" | "slate" | "amber" } {
  switch (status) {
    case "prechecked":
      return { text: "校验通过", tone: "green" };
    case "perp_submitted":
    case "perp_filled":
    case "spot_submitted":
    case "spot_filled":
      return { text: "平仓处理中", tone: "amber" };
    case "closed":
      return { text: "平仓成功", tone: "green" };
    case "protected":
      return { text: "已暂停保护", tone: "red" };
    case "failed":
      return { text: "平仓失败", tone: "red" };
    case "validated":
      return { text: "校验通过", tone: "green" };
    case "blocked":
      return { text: "暂不可执行", tone: "red" };
    default:
      return { text: status ?? "—", tone: "slate" };
  }
}

interface Position {
  id: string;
  symbol: string;
  spotExchange: string;
  perpExchange: string;
  state: string;
  spotNotional?: number;
  perpNotional?: number;
  spotFilledQty?: number;
  perpFilledQty?: number;
  positionDeviation?: number;
  actualBasis?: number;
  createdAtUtc?: number;
}

export default function TradeClosePage() {
  const [data, setData] = useState<{ positions: Position[]; total?: number } | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  // Step ② 生成平仓方案
  const [closePlanResult, setClosePlanResult] = useState<any>(null);
  const [closePlanLoading, setClosePlanLoading] = useState(false);

  // Step ③ 交易所参数校验
  const [spotTestResult, setSpotTestResult] = useState<any>(null);
  const [spotTestLoading, setSpotTestLoading] = useState(false);

  // Step ④ 执行前校验（dry-run）
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  // Step ⑤ 确认平仓（真实下单）
  const [realExecResult, setRealExecResult] = useState<any>(null);
  const [realExecLoading, setRealExecLoading] = useState(false);

  // 平仓门控状态
  const [gate, setGate] = useState<any>(null);

  const fetchAll = () => {
    fetch("/api/v121/positions").then((r) => r.json()).then(setData).catch(() => {});
    fetch("/api/v121/mainnet-tiny/close-gate").then((r) => r.json()).then(setGate).catch(() => {});
  };

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 10000);
    return () => clearInterval(i);
  }, []);

  const positions: Position[] = data?.positions ?? [];

  // ① 选择持仓：只展示可平状态（OPEN / MONITORING / EXITING）
  const closeable = positions.filter((p) =>
    ["OPEN", "MONITORING", "EXITING"].includes(p.state),
  );
  const selectedPosition = closeable.find((p) => p.id === selectedPositionId) ?? null;

  // ② 平仓方案
  const planValidated =
    closePlanResult?.ok === true &&
    closePlanResult?.closePlan?.status === "validated" &&
    closePlanResult?.closePlan?.spotLeg &&
    closePlanResult?.closePlan?.perpLeg;
  const closePlanId = closePlanResult?.closePlan?.id;

  // ③ 交易所参数校验
  const spotTestPassed = spotTestResult?.ok === true;

  // ④ 执行前校验
  const dryRunPassed = dryRunResult?.status === "prechecked";

  // ⑤ 真实平仓
  const realCloseDone = realExecResult?.status === "closed";

  // 真实平仓是否已开启
  const realCloseEnabled =
    gate?.allowed === true && gate?.realCloseEnabled === true;

  // 各步是否就绪
  const step1Done = selectedPosition != null;
  const step2Done = planValidated;
  const step3Done = spotTestPassed;
  const step4Done = dryRunPassed;

  // ── Step ② 生成平仓方案 ─────────────────────────────────
  const generateClosePlan = async () => {
    if (!selectedPosition) return;
    setClosePlanLoading(true);
    setClosePlanResult(null);
    setSpotTestResult(null);
    setDryRunResult(null);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/close-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: selectedPosition.id }),
      });
      setClosePlanResult(await r.json());
    } finally {
      setClosePlanLoading(false);
    }
  };

  // ── Step ③ 交易所参数校验 ───────────────────────────────
  const runSpotTest = async () => {
    if (!closePlanId) return;
    setSpotTestLoading(true);
    setSpotTestResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/close-plan/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closePlanId }),
      });
      setSpotTestResult(await r.json());
    } finally {
      setSpotTestLoading(false);
    }
  };

  // ── Step ④ 执行前校验（dry-run）────────────────────────
  const runDryRun = async () => {
    if (!closePlanId) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/close-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closePlanId, dryRun: true }),
      });
      setDryRunResult(await r.json());
    } finally {
      setDryRunLoading(false);
    }
  };

  // ── Step ⑤ 确认平仓（真实下单）─────────────────────────
  const runRealClose = async () => {
    if (!closePlanId || !dryRunPassed) return;
    // 用户输入产品词 CONFIRM_CLOSE_POSITION；映射成后端确认串再发送。
    const phrase = window.prompt(`请输入 ${USER_CONFIRM_CLOSE} 以确认平仓。确认后将向交易所真实下单平仓。`);
    if (phrase !== USER_CONFIRM_CLOSE) return;
    setRealExecLoading(true);
    setRealExecResult(null);
    try {
      const r = await fetch("/api/v121/mainnet-tiny/close-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closePlanId, dryRun: false, explicitConfirm: BACKEND_CONFIRM_CLOSE }),
      });
      setRealExecResult(await r.json());
    } finally {
      setRealExecLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">平仓</h2>
        <div className="flex gap-2 text-sm">
          <Link
            href="/trade/open"
            className="border border-cyan-500/60 bg-cyan-500/15 px-3 py-1 text-cyan-100 transition-colors hover:bg-cyan-500/25"
          >
            开仓
          </Link>
          <Link
            href="/positions"
            className="border border-gray-600 bg-gray-800/60 px-3 py-1 text-gray-200 transition-colors hover:bg-gray-700/60"
          >
            持仓
          </Link>
        </div>
      </div>

      <p className="mb-6 text-sm text-gray-400">
        按以下 5 步完成一次平仓。每步通过后才能进入下一步，最后一步需要二次确认才会真实下单。
        平仓顺序由系统控制（先平合约空单，再卖现货），确保任何中断都处于已对冲的安全方向。
      </p>

      {/* 步骤指示 */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        {[
          { n: 1, label: "选择持仓", done: step1Done },
          { n: 2, label: "生成平仓方案", done: step2Done },
          { n: 3, label: "交易所参数校验", done: step3Done },
          { n: 4, label: "执行前校验", done: step4Done },
          { n: 5, label: "确认平仓", done: realCloseDone },
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

      {/* ① 选择持仓 */}
      <StepSection n={1} title="选择持仓" tone="cyan" done={step1Done}>
        {closeable.length === 0 ? (
          <div className="text-sm text-amber-300">
            暂无可平持仓。可前往
            <Link href="/trade/open" className="mx-1 underline hover:text-amber-100">开仓页</Link>
            建立仓位，或前往
            <Link href="/positions" className="mx-1 underline hover:text-amber-100">持仓页</Link>
            查看全部持仓。
          </div>
        ) : (
          <div className="space-y-1">
            {closeable.map((p) => {
              const active = p.id === selectedPositionId;
              const dev = Number(p.positionDeviation ?? 0);
              const st = stateLabel(p.state);
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${
                    active
                      ? "border-cyan-500/60 bg-cyan-500/10"
                      : "border-gray-800 bg-gray-900 hover:border-gray-700"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="position"
                      checked={active}
                      onChange={() => {
                        setSelectedPositionId(p.id);
                        // 切换持仓时清空后续步骤
                        setClosePlanResult(null);
                        setSpotTestResult(null);
                        setDryRunResult(null);
                        setRealExecResult(null);
                      }}
                      className="accent-cyan-400"
                    />
                    <span className="font-semibold">{p.symbol}</span>
                    <span className="text-gray-400">{p.spotExchange}→{p.perpExchange}</span>
                    <span className={`text-xs ${st.tone}`}>{st.text}</span>
                  </span>
                  <span className="flex gap-3 font-mono text-xs text-gray-300">
                    <span>现货 {fmtNum(p.spotFilledQty, 6)}</span>
                    <span>合约 {fmtNum(p.perpFilledQty, 6)}</span>
                    <span className={dev > 0.01 ? "text-red-400" : "text-emerald-400"}>
                      偏差 {(dev * 100).toFixed(2)}%
                    </span>
                  </span>
                </label>
              );
            })}
            <div className="text-xs text-gray-500">共 {closeable.length} 个可平持仓</div>
          </div>
        )}
      </StepSection>

      {/* ② 生成平仓方案 */}
      <StepSection n={2} title="生成平仓方案" tone="purple" done={step2Done} disabled={!step1Done}>
        <div className="mb-3">
          <button
            onClick={generateClosePlan}
            disabled={!step1Done || closePlanLoading}
            className="border border-purple-500/60 bg-purple-500/15 px-3 py-1.5 text-sm text-purple-200 rounded disabled:opacity-30"
          >
            {closePlanLoading ? "生成中..." : "生成平仓方案"}
          </button>
        </div>
        {closePlanResult ? (
          <ResultBox ok={closePlanResult.ok === true}>
            <div className={closePlanResult.ok ? "text-emerald-400" : "text-red-400"}>
              {closePlanResult.ok ? "✓ 平仓方案已生成" : `⛔ ${closePlanResult.status ?? "生成失败"}`}
            </div>
            {closePlanResult.closePlan ? (
              <>
                <div className="text-gray-400">
                  系统记录：现货 {fmtNum(closePlanResult.closePlan.systemRecordQty?.spot, 6)}，合约 {fmtNum(closePlanResult.closePlan.systemRecordQty?.perp, 6)}
                </div>
                <div className="text-gray-400">
                  交易所实际：现货 {fmtNum(closePlanResult.closePlan.exchangeActualQty?.spot, 6)}，合约 {fmtNum(closePlanResult.closePlan.exchangeActualQty?.perp, 6)}
                </div>
                <div className="text-cyan-300">
                  可平数量（取较小值）：现货 {fmtNum(closePlanResult.closePlan.closeQty?.spot, 6)}，合约 {fmtNum(closePlanResult.closePlan.closeQty?.perp, 6)}
                </div>
                {closePlanResult.closePlan.spotLeg ? (
                  <div className="text-gray-400">
                    现货卖出：{fmtNum(closePlanResult.closePlan.spotLeg.quantity, 6)} @ ${fmtNum(closePlanResult.closePlan.spotLeg.estimatedPrice)} = ${fmtNum(closePlanResult.closePlan.spotLeg.quoteNotionalUsdt)}
                  </div>
                ) : null}
                {closePlanResult.closePlan.perpLeg ? (
                  <div className="text-gray-400">
                    合约平空：{fmtNum(closePlanResult.closePlan.perpLeg.quantity, 6)} @ ${fmtNum(closePlanResult.closePlan.perpLeg.estimatedPrice)} = ${fmtNum(closePlanResult.closePlan.perpLeg.quoteNotionalUsdt)}
                  </div>
                ) : null}
              </>
            ) : null}
            {closePlanResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{closePlanResult.blockers.join(", ")}</div>
            ) : null}
            {closePlanResult.warnings?.length > 0 ? (
              <div className="text-amber-400">提示：{closePlanResult.warnings.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ③ 交易所参数校验 */}
      <StepSection n={3} title="交易所参数校验" tone="cyan" done={step3Done} disabled={!step2Done}>
        <div className="mb-3">
          <button
            onClick={runSpotTest}
            disabled={!step2Done || spotTestLoading}
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

      {/* ④ 执行前校验 */}
      <StepSection n={4} title="执行前校验" tone="amber" done={step4Done} disabled={!step3Done}>
        <p className="mb-3 text-xs text-gray-500">
          此步骤用于确认当前平仓条件仍然有效，不会改变账户持仓。通过后才能进入确认平仓。
        </p>
        <div className="mb-3">
          <button
            onClick={runDryRun}
            disabled={!step3Done || dryRunLoading}
            className="border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200 rounded disabled:opacity-30"
          >
            {dryRunLoading ? "校验中..." : "执行前校验"}
          </button>
        </div>
        {dryRunResult ? (
          <ResultBox ok={dryRunPassed}>
            <div className={dryRunPassed ? "text-emerald-400" : "text-red-400"}>
              {dryRunPassed
                ? "✓ 执行前校验通过，可进入确认平仓"
                : `⛔ ${translateCloseStatus(dryRunResult.status).text}${dryRunResult.frozenReason ? `：${dryRunResult.frozenReason}` : ""}`}
            </div>
            {dryRunResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{dryRunResult.blockers.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
      </StepSection>

      {/* ⑤ 确认平仓 */}
      <StepSection n={5} title="确认平仓" tone="red" done={realCloseDone} disabled={!step4Done}>
        {realCloseEnabled ? (
          <p className="mb-3 text-xs text-gray-500">
            点击后将弹出确认框，需要输入 <code className="rounded bg-gray-800 px-1 text-cyan-300">{USER_CONFIRM_CLOSE}</code> 才会真实下单。
            系统会先平合约空单，再卖现货。如中途异常，仓位将进入已暂停保护状态，需人工处理。
          </p>
        ) : (
          <p className="mb-3 text-xs text-gray-500">
            真实平仓当前未开启。系统会继续监控持仓，开启真实平仓需要管理员完成安全配置。
          </p>
        )}
        <div className="mb-3">
          <button
            onClick={runRealClose}
            disabled={!step4Done || !realCloseEnabled || realExecLoading || realCloseDone}
            className="border border-red-500/60 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200 rounded disabled:opacity-30"
          >
            {realExecLoading ? "平仓中..." : realCloseDone ? "已平仓" : "确认平仓"}
          </button>
        </div>
        {realExecResult ? (
          <ResultBox ok={realCloseDone}>
            <div className={realCloseDone ? "text-emerald-400" : realExecResult.status === "protected" ? "text-amber-400" : "text-red-400"}>
              {realCloseDone
                ? "✓ 平仓成功"
                : `⛔ ${translateCloseStatus(realExecResult.status).text}${realExecResult.frozenReason ? `：${realExecResult.frozenReason}` : ""}`}
            </div>
            {realExecResult.perpCloseOrder ? <div className="text-gray-400">合约平空腿：{realExecResult.perpCloseOrder.status}</div> : null}
            {realExecResult.spotCloseOrder ? <div className="text-gray-400">现货卖出腿：{realExecResult.spotCloseOrder.status}</div> : null}
            {realExecResult.verification ? (
              <div className="text-gray-400">
                平仓后验证：合约清空 {realExecResult.verification.perpShortCleared ? "✓" : "✗"}，现货减少 {realExecResult.verification.spotBalanceReduced ? "✓" : "✗"}
              </div>
            ) : null}
            {realExecResult.finalPnlEstimate ? (
              <div className="text-emerald-300">
                估算净收益：{fmtUsd(realExecResult.finalPnlEstimate.netProfit)}
              </div>
            ) : null}
            {realExecResult.blockers?.length > 0 ? (
              <div className="text-red-400">暂不可执行：{realExecResult.blockers.join(", ")}</div>
            ) : null}
          </ResultBox>
        ) : null}
        {realCloseDone ? (
          <div className="mt-3 text-sm text-emerald-200">
            平仓已完成，可前往
            <Link href="/positions" className="mx-1 underline hover:text-emerald-100">持仓页</Link>
            查看持仓，或前往
            <Link href="/review" className="mx-1 underline hover:text-emerald-100">复盘页</Link>
            查看本次平仓记录。
          </div>
        ) : null}
        {realExecResult?.status === "protected" ? (
          <div className="mt-3 rounded border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-amber-200">
            仓位已进入已暂停保护状态。请前往
            <Link href="/risk" className="mx-1 underline hover:text-amber-100">风控页</Link>
            查看详情并人工处理，不要重复尝试自动平仓。
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
