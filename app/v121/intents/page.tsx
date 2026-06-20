"use client";

import { useEffect, useState } from "react";

export default function IntentsPage() {
  const [intents, setIntents] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/v121/mainnet-tiny/intents")
      .then((r) => r.json())
      .then((d) => setIntents(d.intents ?? []))
      .catch(() => {});
  }, []);

  const eligible = intents.filter(
    (i) => i.purpose === "real_arbitrage" && i.simulationOnly !== true && i.realTradeEligible === true,
  );

  const filtered =
    filter === "eligible"
      ? eligible
      : filter === "rehearsal"
        ? intents.filter((i) => i.purpose === "execution_rehearsal" || i.simulationOnly)
        : filter === "blocked"
          ? intents.filter((i) => i.gateAllowed === false || (i.blockedReasons?.length ?? 0) > 0)
          : intents;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">执行意图</h2>
      <p className="text-sm text-gray-500 mb-4">
        执行意图是机会池和真实下单之间的中间层。只有 real_arbitrage + simulationOnly=false + realTradeEligible=true 的意图才能进入执行中心。
      </p>

      <div className="flex gap-2 mb-4">
        {["all", "eligible", "rehearsal", "blocked"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded ${filter === f ? "bg-cyan-900 text-cyan-200 border border-cyan-600" : "bg-gray-800 text-gray-400 border border-gray-700"}`}
          >
            {{ all: "全部", eligible: "正式可执行", rehearsal: "模拟演练", blocked: "被拦截" }[f] ?? f}
          </button>
        ))}
      </div>

      <div className="text-sm text-gray-500 mb-2">
        共 {filtered.length} 条 | 正式可执行: {eligible.length}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left py-2 pr-3">Intent ID</th>
              <th className="text-left py-2 pr-3">币种</th>
              <th className="text-left py-2 pr-3">交易所</th>
              <th className="text-left py-2 pr-3">目的</th>
              <th className="text-center py-2 pr-3">模拟</th>
              <th className="text-center py-2 pr-3">真实可执行</th>
              <th className="text-right py-2 pr-3">金额</th>
              <th className="text-right py-2 pr-3">时间</th>
              <th className="text-left py-2">原因</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i: any) => (
              <tr key={i.id ?? i.intentId} className="border-b border-gray-800/50 text-gray-300">
                <td className="py-2 pr-3 font-mono text-xs">{(i.intentId ?? i.id ?? "").slice(0, 16)}</td>
                <td className="py-2 pr-3">{i.symbol ?? "—"}</td>
                <td className="py-2 pr-3">{i.spotExchange ?? i.exchange ?? "—"}</td>
                <td className="py-2 pr-3">{i.purpose ?? "—"}</td>
                <td className="py-2 pr-3 text-center">{i.simulationOnly ? "✅" : "❌"}</td>
                <td className="py-2 pr-3 text-center">{i.realTradeEligible ? "✅" : "❌"}</td>
                <td className="py-2 pr-3 text-right">${i.plannedNotionalUsdt?.toFixed(2) ?? "—"}</td>
                <td className="py-2 pr-3 text-right text-xs">{i.createdAtUtc ? new Date(i.createdAtUtc).toLocaleString() : "—"}</td>
                <td className="py-2 text-xs text-gray-500">{(i.blockedReasons ?? []).slice(0, 2).join(", ") || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-600">暂无执行意图记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
