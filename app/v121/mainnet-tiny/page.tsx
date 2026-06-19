"use client";

import { useEffect, useState } from "react";

export default function MainnetTinyPage() {
  const [gate, setGate] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [intents, setIntents] = useState<any[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [execDecision, setExecDecision] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/mainnet-tiny/gate").then(r => r.json()).then(setGate).catch(() => {});
    fetch("/api/v121/mainnet-tiny/preflight").then(r => r.json()).then(setPreflight).catch(() => {});
    fetch("/api/v121/mainnet-tiny/intents").then(r => r.json()).then(d => setIntents(d.intents ?? [])).catch(() => {});
    fetch("/api/v121/mainnet-tiny/blocked-attempts").then(r => r.json()).then(d => setBlocked(d.attempts ?? [])).catch(() => {});
    fetch("/api/v121/mainnet-tiny/orchestrator").then(r => r.json()).then(setExecDecision).catch(() => {});
    fetch("/api/v121/settings").then(r => r.json()).then(setSettings).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">MAINNET_TINY 安全门</h2>

      {gate && (
        <div className={gate.allowed
          ? "bg-amber-950/30 border border-amber-800/40 rounded p-4 mb-4"
          : "bg-red-950/30 border border-red-800/40 rounded p-4 mb-4"}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-2xl ${gate.allowed ? "" : "animate-pulse"}`}>{gate.allowed ? "🟡" : "🔴"}</span>
            <span className={`font-bold text-lg ${gate.allowed ? "text-amber-300" : "text-red-300"}`}>
              {gate.allowed ? "配置门已满足" : "环境门未满足"}
            </span>
          </div>
          <p className="text-sm text-gray-300">
            {gate.allowed
              ? "配置门已满足，但真实执行仍需项目方单独确认。当前阶段不会真实下单。"
              : gate.message}
          </p>
          <div className="mt-2 p-2 bg-red-900/30 border border-red-700/30 rounded text-center">
            <span className="text-red-300 font-bold text-sm">⛔ MAINNET_TINY 准备阶段：当前不会真实下单</span>
          </div>
        </div>
      )}

      {/* 环境变量门 */}
      {gate && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">环境变量门</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <GateItem label="V121_MODE" expected="MAINNET_TINY" actual={gate.mode} ok={gate.mode === "MAINNET_TINY"} />
            <GateItem label="V121_MAINNET_TINY_ENABLED" expected="true" actual="(已检查)" ok={!gate.missing.some((m: string) => m.includes("ENABLED"))} />
            <GateItem label="V121_CONFIRM_MAINNET_TINY_RISK" expected="I_UNDERSTAND" actual="(已检查)" ok={!gate.missing.some((m: string) => m.includes("RISK"))} />
            <GateItem label="V121_LIVE_ENABLED" expected="false" actual="(已检查)" ok={!gate.warnings.some((w: string) => w.includes("LIVE_ENABLED"))} />
            <GateItem label="Kill Switch" expected="OFF" actual={gate.killSwitch} ok={gate.killSwitch === "OFF"} />
            <GateItem label="持久化模式" expected="sqlite-active" actual={gate.persistenceMode} ok={gate.persistenceMode === "sqlite-active"} />
          </div>
          {gate.missing.length > 0 && (
            <div className="mt-2 text-xs text-red-400">
              缺失项: {gate.missing.join("；")}
            </div>
          )}
          {gate.warnings.length > 0 && (
            <div className="mt-1 text-xs text-amber-400">
              警告: {gate.warnings.join("；")}
            </div>
          )}
        </section>
      )}

      {/* 限制表 */}
      {gate?.limits && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">MAINNET_TINY 限制</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <LimitRow label="单笔上限" value={`${gate.limits.maxOrderNotionalUsdt} USDT`} />
            <LimitRow label="总暴露上限" value={`${gate.limits.maxTotalExposureUsdt} USDT`} />
            <LimitRow label="每日最多" value={`${gate.limits.maxDailyTrades} 笔`} />
            <LimitRow label="最大杠杆" value={`${gate.limits.leverage}x`} />
            <LimitRow label="HTX" value={gate.limits.allowHtx ? "允许" : "禁用"} blocked={!gate.limits.allowHtx} />
            <LimitRow label="小币种" value={gate.limits.allowSmallCaps ? "允许" : "禁用"} blocked={!gate.limits.allowSmallCaps} />
            <LimitRow label="跨所" value={gate.limits.allowCrossExchange ? "允许" : "禁用"} blocked={!gate.limits.allowCrossExchange} />
            <LimitRow label="自动开仓" value={gate.limits.allowAutoEntry ? "允许" : "禁用"} blocked={!gate.limits.allowAutoEntry} />
            <LimitRow label="人工确认" value={gate.limits.requireManualConfirm ? "必须" : "不需要"} blocked={gate.limits.requireManualConfirm} />
          </div>
        </section>
      )}

      {/* Preflight */}
      {preflight && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-3 text-purple-400">
            预飞检查 (就绪分数: {preflight.readinessScore}/100)
          </h3>
          <div className="text-xs text-red-400 mb-2">⛔ 当前阶段不会真实下单。allowedForActualExecution = false</div>
          <div className="space-y-1">
            {preflight.checks.map((c: any, i: number) => (
              <div key={i} className={`flex items-center justify-between text-xs border-b border-gray-800 py-1 ${
                c.passed ? "text-green-400" : c.severity === "critical" ? "text-red-400" : "text-amber-400"
              }`}>
                <span>{c.name}</span>
                <span>{c.passed ? "✅" : "❌"} {c.chineseMessage}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 最近 intents */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-green-400">最近执行意图</h3>
        {intents.length === 0 ? (
          <p className="text-xs text-gray-500">暂无记录 — 所有意图仅记录，不会真实下单</p>
        ) : (
          <div className="space-y-1 text-xs">
            {intents.slice(-5).reverse().map((i: any) => (
              <div key={i.intentId} className="border border-gray-800 rounded p-2">
                <span className="font-semibold">{i.symbol}</span>
                <span className="mx-2 text-gray-500">{i.spotExchange}→{i.perpExchange}</span>
                <span className="text-gray-400">${i.plannedNotionalUsdt}</span>
                <span className={`ml-2 ${i.gateAllowed ? "text-green-400" : "text-red-400"}`}>{i.gateAllowed ? "通过" : "拦截"}</span>
                {i.blockedReasons.length > 0 && <div className="text-red-400 mt-1">{i.blockedReasons.join("；")}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 自动内部划转 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">自动内部划转</h3>
        <div className="text-sm space-y-2">
          <div className="flex justify-between"><span className="text-gray-400">划转模式</span><span className="font-mono">{settings?.transfer?.mode ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">最大自动划转</span><span className="font-mono">${settings?.transfer?.maxAutoTransferUsdt ?? "—"} USDT</span></div>
          <div className="flex justify-between"><span className="text-gray-400">可执行自动划转</span><span className={execDecision?.autoTransferExecutable ? "text-green-400" : "text-red-400"}>{execDecision?.autoTransferExecutable ? "✅ 是" : "❌ 否"}</span></div>
          {execDecision?.transferPlan && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <div className="text-xs text-gray-500 mb-1">当前 Transfer Plan:</div>
              <div className="text-xs font-mono bg-gray-800 p-2 rounded space-y-1">
                <div>交易所: {execDecision.transferPlan.exchange}</div>
                <div>方向: {execDecision.transferPlan.fromAccount} → {execDecision.transferPlan.toAccount}</div>
                <div>金额: {execDecision.transferPlan.amountUsdt} USDT</div>
                <div>原因: {execDecision.transferPlan.reason}</div>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={async () => {
            if (!execDecision?.transferPlan) return;
            await fetch("/api/v121/mainnet-tiny/auto-transfer", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: execDecision.intentId, decisionId: execDecision.sessionId, transferPlan: execDecision.transferPlan, dryRun: true }),
            });
            alert("Dry-run 划转完成（无真实划转）");
          }} disabled={!execDecision?.transferPlan} className="border border-yellow-500/60 bg-yellow-500/15 text-yellow-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">Dry-run 内部划转并重新审计</button>
          <button onClick={async () => {
            if (!execDecision?.transferPlan || !execDecision?.autoTransferExecutable) return;
            const phrase = window.prompt("输入 EXECUTE_REAL_INTERNAL_TRANSFER 确认真实内部划转。不会下单，但会移动交易所账户资金。");
            if (phrase !== "EXECUTE_REAL_INTERNAL_TRANSFER") return;
            const r = await fetch("/api/v121/mainnet-tiny/auto-transfer", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: execDecision.intentId, decisionId: execDecision.sessionId, transferPlan: execDecision.transferPlan, dryRun: false, explicitConfirm: "EXECUTE_REAL_INTERNAL_TRANSFER" }),
            });
            const d = await r.json();
            alert(d.ok ? `划转已提交: ${d.status}` : `划转失败: ${(d.blockers ?? []).join(", ")}`);
          }} disabled={!execDecision?.transferPlan || !execDecision?.autoTransferExecutable} className="border border-red-500/60 bg-red-500/15 text-red-200 px-3 py-1.5 text-sm rounded disabled:opacity-30">执行真实内部划转并重新审计</button>
          {execDecision?.transferPlan?.exchange === "okx" && (
            <span className="text-xs text-gray-500 self-center ml-2">OKX 真实内部划转尚未启用，仅支持 dry-run。</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-3 border-t border-gray-800 pt-2">
          真实内部划转只会在同一交易所账户间转 USDT，不会下单。划转后必须重新审计。
        </p>
      </section>

      {/* 拦截记录 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-red-400">拦截记录</h3>
        {blocked.length === 0 ? (
          <p className="text-xs text-gray-500">暂无拦截记录</p>
        ) : (
          <div className="space-y-1 text-xs">
            {blocked.slice(-5).reverse().map((b: any) => (
              <div key={b.id} className="border border-gray-800 rounded p-2">
                <span className="text-red-400">{b.action}</span>
                <span className="mx-2 text-gray-500">{b.mode}</span>
                <span className="text-gray-400">{b.reason}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GateItem({ label, expected, actual, ok }: { label: string; expected: string; actual: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-1">
      <span className="text-gray-400">{label}</span>
      <span className={ok ? "text-green-400" : "text-red-400"}>{ok ? "✅" : "❌"}</span>
    </div>
  );
}

function LimitRow({ label, value, blocked }: { label: string; value: string; blocked?: boolean }) {
  return (
    <div className="flex justify-between border-b border-gray-800 py-1">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono ${blocked ? "text-red-400" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}
