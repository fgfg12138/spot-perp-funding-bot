"use client";

import { useEffect, useState } from "react";

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

export default function ExecutionPage() {
  const [intents, setIntents] = useState<any[]>([]);
  const [orderPlans, setOrderPlans] = useState<any[]>([]);
  const [orderExecs, setOrderExecs] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [execDecision, setExecDecision] = useState<any>(null);
  const [transferResult, setTransferResult] = useState<any>(null);
  const [orderPlanResult, setOrderPlanResult] = useState<any>(null);
  const [orderPlanLoading, setOrderPlanLoading] = useState(false);
  const [execResult, setExecResult] = useState<any>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);

  const fetchAll = () => {
    fetch("/api/v121/mainnet-tiny/intents").then(r => r.json()).then(d => setIntents(d.intents ?? [])).catch(() => {});
    fetch("/api/v121/mainnet-tiny/order-plan").then(r => r.json()).then(d => setOrderPlans(d.records ?? [])).catch(() => {});
    fetch("/api/v121/mainnet-tiny/order-execution").then(r => r.json()).then(d => setOrderExecs(d.records ?? [])).catch(() => {});
    fetch("/api/v121/settings").then(r => r.json()).then(d => setSettings(d.settings ?? d)).catch(() => {});
    fetch("/api/v121/mainnet-tiny/orchestrator").then(r => r.json()).then(setExecDecision).catch(() => {});
  };

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 10000); return () => clearInterval(i); }, []);

  const eligible = (intents ?? []).filter(
    (i: any) => i.purpose === "real_arbitrage" && !toBool(i.simulationOnly) && toBool(i.realTradeEligible),
  );
  const latestPlan = orderPlans[0];
  const planValidated = latestPlan?.status === "validated" && latestPlan?.spotLeg && latestPlan?.perpLeg;
  const hasRealGate = true; // Gate controlled by backend only; UI hint

  // ── Order Plan ─────────────────────────────────────────────
  const generateOrderPlan = async () => {
    setOrderPlanLoading(true);
    try {
      const intent = eligible[0];
      if (!intent) { alert("暂无合格正式套利机会。"); return; }
      const r = await fetch("/api/v121/mainnet-tiny/order-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: intent.intentId ?? intent.id,
          exchange: "binance", symbol: intent.symbol,
          plannedNotionalUsdt: Number(settings?.notional?.plannedNotionalUsdt ?? 10),
        }),
      });
      const d = await r.json();
      setOrderPlanResult(d);
      fetchAll();
    } finally { setOrderPlanLoading(false); }
  };

  const spotTest = async () => {
    if (!latestPlan || latestPlan.status !== "validated") { alert("只有 validated orderPlan 才能做 Spot test。"); return; }
    const r = await fetch("/api/v121/mainnet-tiny/order-plan/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderPlanId: latestPlan.id }),
    });
    const d = await r.json();
    alert(d.ok ? `校验通过` : `校验失败: ${(d.blockers ?? [d.error ?? "unknown"]).join(", ")}`);
  };

  // ── Transfer ───────────────────────────────────────────────
  const dryRunTransfer = async () => {
    if (!execDecision?.transferPlan) return;
    setTransferLoading(true);
    const r = await fetch("/api/v121/mainnet-tiny/auto-transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: execDecision.intentId, decisionId: execDecision.sessionId, transferPlan: execDecision.transferPlan, dryRun: true }),
    });
    setTransferResult(await r.json());
    setTransferLoading(false);
  };

  const realTransfer = async () => {
    if (!execDecision?.transferPlan) return;
    const phrase = window.prompt("输入 EXECUTE_REAL_INTERNAL_TRANSFER 确认真实内部划转。划转不是下单。划转后必须重新审计，再重新生成 orderPlan。");
    if (phrase !== "EXECUTE_REAL_INTERNAL_TRANSFER") return;
    setTransferLoading(true);
    const r = await fetch("/api/v121/mainnet-tiny/auto-transfer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: execDecision.intentId, decisionId: execDecision.sessionId, transferPlan: execDecision.transferPlan, dryRun: false, explicitConfirm: "EXECUTE_REAL_INTERNAL_TRANSFER" }),
    });
    setTransferResult(await r.json());
    setTransferLoading(false);
  };

  // ── Execution ──────────────────────────────────────────────
  const dryRun = async () => {
    if (!planValidated) return;
    setExecLoading(true);
    const r = await fetch("/api/v121/mainnet-tiny/order-execution", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderPlanId: latestPlan.id, dryRun: true }),
    });
    setExecResult(await r.json());
    fetchAll();
    setExecLoading(false);
  };

  const realExec = async () => {
    if (!planValidated) return;
    const phrase = window.prompt("输入 EXECUTE_REAL_TWO_LEG_ORDER 确认真实双腿下单。");
    if (phrase !== "EXECUTE_REAL_TWO_LEG_ORDER") return;
    setExecLoading(true);
    const r = await fetch("/api/v121/mainnet-tiny/order-execution", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderPlanId: latestPlan.id, dryRun: false, explicitConfirm: "EXECUTE_REAL_TWO_LEG_ORDER" }),
    });
    setExecResult(await r.json());
    fetchAll();
    setExecLoading(false);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">执行中心</h2>

      {/* 1. 内部划转 / 资金准备 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">内部划转 / 资金准备</h3>
        <div className="text-sm space-y-2">
          <div className="flex justify-between"><span className="text-gray-400">划转模式</span><span className="font-mono">{settings?.transfer?.mode ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">最大自动划转</span><span className="font-mono">${fmtNum(settings?.transfer?.maxAutoTransferUsdt)} USDT</span></div>
          <div className="flex justify-between"><span className="text-gray-400">可执行自动划转</span><span className={execDecision?.autoTransferExecutable ? "text-green-400" : "text-red-400"}>{execDecision?.autoTransferExecutable ? "✅" : "❌"}</span></div>
          {execDecision?.transferPlan && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <div className="text-xs text-gray-500 mb-1">当前 Transfer Plan:</div>
              <div className="text-xs font-mono bg-gray-800 p-2 rounded">
                <div>{execDecision.transferPlan.fromAccount} → {execDecision.transferPlan.toAccount} | {execDecision.transferPlan.amountUsdt} USDT | {execDecision.transferPlan.reason}</div>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={dryRunTransfer} disabled={transferLoading || !execDecision?.transferPlan} className="border border-yellow-500/60 bg-yellow-500/15 text-yellow-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            {transferLoading ? "执行中..." : "Dry-run 内部划转并重新审计"}
          </button>
          <button onClick={realTransfer} disabled={transferLoading || !execDecision?.transferPlan} className="border border-red-500/60 bg-red-500/15 text-red-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            真实内部划转并重新审计
          </button>
        </div>
        {transferResult && (
          <div className="mt-2 text-xs font-mono bg-gray-800 p-2 rounded">
            <div className={transferResult.ok ? "text-green-400" : "text-red-400"}>{transferResult.status}{transferResult.blockers?.length > 0 ? `: ${transferResult.blockers.join(", ")}` : ""}</div>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">划转不是下单。划转后必须重新审计，再重新生成 orderPlan。</p>
      </section>

      {/* 2. 正式 Intent 队列 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">正式 Intent 队列</h3>
        {eligible.length === 0 ? (
          <p className="text-yellow-400 text-sm">暂无合格正式套利机会。需要 real_arbitrage + simulationOnly=false + realTradeEligible=true 的 intent。</p>
        ) : (
          <div className="text-sm space-y-1">
            {eligible.slice(0, 5).map((i: any) => (
              <div key={i.id ?? i.intentId} className="flex justify-between border-b border-gray-800 py-1">
                <span className="text-gray-400">{(i.symbol ?? "")} ({i.spotExchange ?? ""})</span>
                <span className="text-gray-200 font-mono text-xs">${fmtNum(i.plannedNotionalUsdt, 2)}</span>
              </div>
            ))}
            <div className="text-xs text-gray-500 mt-2">{eligible.length} 个正式 Intent 可用</div>
          </div>
        )}
      </section>

      {/* 3. OrderPlan 生成与校验 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-purple-400">OrderPlan 生成与校验</h3>
        <div className="flex gap-2 mb-3">
          <button onClick={generateOrderPlan} disabled={orderPlanLoading || eligible.length === 0} className="border border-purple-500/60 bg-purple-500/15 text-purple-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            {orderPlanLoading ? "生成中..." : "生成下单计划"}
          </button>
          <button onClick={spotTest} disabled={!planValidated} className="border border-cyan-500/60 bg-cyan-500/15 text-cyan-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            Spot test order 校验
          </button>
        </div>
        {orderPlanResult && (
          <div className="text-xs font-mono bg-gray-800 p-2 rounded space-y-1">
            <div className={orderPlanResult.ok ? "text-green-400" : "text-red-400"}>{orderPlanResult.ok ? "✅ validated" : `⛔ ${orderPlanResult.status}`}</div>
            {orderPlanResult.orderPlan?.spotLeg && <div className="text-gray-400">Spot: {fmtNum(orderPlanResult.orderPlan.spotLeg.quantity, 6)} @ ${fmtNum(orderPlanResult.orderPlan.spotLeg.estimatedPrice, 2)} = ${fmtNum(orderPlanResult.orderPlan.spotLeg.quoteNotionalUsdt, 2)}</div>}
            {orderPlanResult.orderPlan?.perpLeg && <div className="text-gray-400">Perp: {fmtNum(orderPlanResult.orderPlan.perpLeg.quantity, 6)} @ ${fmtNum(orderPlanResult.orderPlan.perpLeg.estimatedPrice, 2)} = ${fmtNum(orderPlanResult.orderPlan.perpLeg.quoteNotionalUsdt, 2)}</div>}
            {orderPlanResult.blockers?.length > 0 && <div className="text-red-400">blockers: {orderPlanResult.blockers.join(", ")}</div>}
            <div className="text-red-400 font-bold">allowedForActualOrder: false</div>
          </div>
        )}
      </section>

      {/* 4. 双腿执行 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">双腿执行</h3>
        <div className="flex gap-2 mb-3">
          <button onClick={dryRun} disabled={execLoading || !planValidated} className="border border-yellow-500/60 bg-yellow-500/15 text-yellow-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            {execLoading ? "执行中..." : "Dry-run 执行双腿下单"}
          </button>
          <button onClick={realExec} disabled={execLoading || !planValidated || !hasRealGate} className="border border-red-500/60 bg-red-500/15 text-red-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">
            真实执行双腿下单
          </button>
        </div>
        {!hasRealGate && <p className="text-xs text-gray-500 mt-2">真实执行前端提示未开启。即使按钮显示，后端仍需 V121_ENABLE_REAL_ORDER_EXECUTION=1 和 explicitConfirm。</p>}
        {execResult && (
          <div className="text-xs font-mono bg-gray-800 p-2 rounded space-y-1">
            <div className={execResult.status === "dry_run" || execResult.status === "filled" ? "text-green-400" : "text-red-400"}>
              {execResult.status}{execResult.frozenReason ? ` (frozen: ${execResult.frozenReason})` : ""}
            </div>
            {execResult.blockers?.length > 0 && <div className="text-red-400">blockers: {execResult.blockers.join(", ")}</div>}
            {execResult.spot && <div className="text-gray-400">Spot: {execResult.spot.status}</div>}
            {execResult.perp && <div className="text-gray-400">Perp: {execResult.perp.status}</div>}
          </div>
        )}
      </section>

      {/* 5. Execution Ledger */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-gray-400">Execution Ledger</h3>
        {orderExecs.length === 0 ? (
          <p className="text-gray-600 text-sm">暂无执行记录</p>
        ) : (
          <div className="space-y-1 text-xs">
            {orderExecs.slice(0, 10).map((e: any) => (
              <div key={e.id} className="flex justify-between border-b border-gray-800 py-1">
                <span className={e.status === "filled" ? "text-green-400" : e.status === "frozen" ? "text-red-400" : "text-gray-400"}>
                  {e.status}{e.frozenReason ? ` (${e.frozenReason})` : ""}
                </span>
                <span className="text-gray-500">{e.symbol}</span>
                <span className="text-gray-600">{new Date(e.createdAtUtc).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
