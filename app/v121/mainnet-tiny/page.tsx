"use client";

import { useEffect, useState } from "react";

export default function MainnetTinyPage() {
  const [gate, setGate] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [intents, setIntents] = useState<any[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/v121/mainnet-tiny/gate").then(r => r.json()).then(setGate).catch(() => {});
    fetch("/api/v121/mainnet-tiny/preflight").then(r => r.json()).then(setPreflight).catch(() => {});
    fetch("/api/v121/mainnet-tiny/intents").then(r => r.json()).then(d => setIntents(d.intents ?? [])).catch(() => {});
    fetch("/api/v121/mainnet-tiny/blocked-attempts").then(r => r.json()).then(d => setBlocked(d.attempts ?? [])).catch(() => {});
  }, []);

  const eligible = (intents ?? []).filter(
    (i: any) => i.purpose === "real_arbitrage" && i.realTradeEligible === true,
  );

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
          <p className="text-sm text-gray-300">{gate.allowed ? "配置门已满足，但真实执行仍需项目方单独确认。当前阶段不会真实下单。" : gate.message}</p>
          <div className="mt-2 p-2 bg-red-900/30 border border-red-700/30 rounded text-center">
            <span className="text-red-300 font-bold text-sm">⛔ MAINNET_TINY 准备阶段：当前不会真实下单</span>
          </div>
        </div>
      )}

      {/* 环境变量门 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">环境变量门</h3>
        {gate?.details ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(gate.details).map(([k, v]: [string, any]) => (
              <GateItem key={k} label={k} expected={v.expected} actual={v.actual} ok={v.ok} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">加载中...</p>
        )}
      </section>

      {/* MAINNET_TINY 限制 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-green-400">MAINNET_TINY 限制</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <LimitRow label="单笔上限" value="10 USDT" />
          <LimitRow label="总暴露上限" value="50 USDT" />
          <LimitRow label="每日最多" value="3 笔" />
          <LimitRow label="最大杠杆" value="1x" />
          <LimitRow label="HTX" value="禁用" blocked />
          <LimitRow label="小币种" value="禁用" blocked />
          <LimitRow label="跨所" value="禁用" blocked />
          <LimitRow label="自动开仓" value="禁用" blocked />
          <LimitRow label="人工确认" value="必须" />
        </div>
      </section>

      {/* 预飞检查 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">预飞检查</h3>
        {preflight?.items ? (
          <div className="space-y-1 text-sm">
            {preflight.items.map((item: any, idx: number) => (
              <div key={idx} className={`flex justify-between py-1 ${item.severity === "error" ? "text-red-400" : item.severity === "warning" ? "text-yellow-400" : "text-gray-400"}`}>
                <span>{item.label}</span>
                <span>{item.status ? "✅" : "❌"} {item.message ?? ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">加载中...</p>
        )}
        {preflight && <div className="mt-2 text-sm">就绪分数: {preflight.readinessScore ?? "—"}/100</div>}
      </section>

      {/* 最近正式 Intent 概览 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-purple-400">最近正式 Intent</h3>
        {eligible.length === 0 ? (
          <p className="text-yellow-400 text-sm">暂无合格正式套利机会。</p>
        ) : (
          <div className="text-sm space-y-1">
            {eligible.slice(0, 5).map((i: any) => (
              <div key={i.id ?? i.intentId} className="flex justify-between border-b border-gray-800 py-1">
                <span className="text-gray-400">{i.symbol ?? "—"}</span>
                <span className="text-gray-200 font-mono text-xs">${Number(i.plannedNotionalUsdt ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 拦截记录 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-red-400">拦截记录</h3>
        {blocked.length === 0 ? <p className="text-gray-500 text-sm">无拦截记录</p> : (
          <div className="text-sm space-y-1">
            {blocked.slice(0, 5).map((b: any, idx: number) => (
              <div key={idx} className="flex justify-between border-b border-gray-800 py-1">
                <span className="text-gray-400">{b.symbol ?? "—"}</span>
                <span className="text-gray-500 text-xs">{b.reason ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 执行中心跳转 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-purple-400">执行中心</h3>
        <p className="text-sm text-gray-500 mb-3">
          OrderPlan 生成、Spot test 校验、内部划转、Dry-run 执行、真实执行全部在统一执行中心操作。
        </p>
        <a href="/v121/execution" className="inline-block border border-cyan-500/60 bg-cyan-500/15 text-cyan-200 px-4 py-2 text-sm rounded hover:bg-cyan-500/25">
          去执行中心处理 orderPlan →
        </a>
      </section>
    </div>
  );
}

function GateItem({ label, expected, actual, ok }: { label: string; expected: string; actual: string; ok: boolean }) {
  return <div className="flex items-center justify-between border-b border-gray-800 py-1"><span className="text-gray-400">{label}</span><span className={ok ? "text-green-400" : "text-red-400"}>{ok ? "✅" : "❌"}</span></div>;
}

function LimitRow({ label, value, blocked }: { label: string; value: string; blocked?: boolean }) {
  return <div className="flex justify-between border-b border-gray-800 py-1"><span className="text-gray-400">{label}</span><span className={`font-mono ${blocked ? "text-red-400" : "text-gray-200"}`}>{value}</span></div>;
}
