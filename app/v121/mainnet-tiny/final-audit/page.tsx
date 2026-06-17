"use client";

import { useEffect, useState } from "react";

export default function FinalAuditPage() {
  const [audit, setAudit] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/mainnet-tiny/final-audit").then(r => r.json()).then(setAudit).catch(() => {});
  }, []);

  if (!audit) return <div className="text-gray-500 p-8">加载中...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">实盘前最终审计</h2>

      <div className="bg-red-950/30 border-2 border-red-700/50 rounded p-4 mb-6 text-center">
        <span className="text-red-300 font-bold text-lg">⛔ 当前仍不会真实下单。没有项目方单独批准，不允许进入 M9 actual execution。</span>
      </div>

      <div className={`rounded p-4 mb-4 ${audit.readyForManual10uApproval ? "bg-green-950/30 border border-green-700/50" : "bg-red-950/30 border border-red-700/50"}`}>
        <div className="text-lg font-bold mb-2">
          {audit.readyForManual10uApproval ? "✅ 具备申请 10U 手动验证条件" : "❌ 尚未满足 10U 验证条件"}
        </div>
        <div className="text-sm text-gray-400">allowedForActualExecution = <span className="text-red-400 font-bold">false</span></div>
      </div>

      {audit.blockers.length > 0 && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2 text-red-400">阻塞项 ({audit.blockers.length})</h3>
          {audit.blockers.map((b: string, i: number) => (
            <div key={i} className="text-sm text-red-300 py-1">❌ {b}</div>
          ))}
        </section>
      )}

      {audit.warnings.length > 0 && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2 text-amber-400">警告 ({audit.warnings.length})</h3>
          {audit.warnings.map((w: string, i: number) => (
            <div key={i} className="text-sm text-amber-300 py-1">⚠️ {w}</div>
          ))}
        </section>
      )}

      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">证据</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {Object.entries(audit.evidence ?? {}).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-gray-800 py-1">
              <span className="text-gray-400">{k}</span>
              <span className="text-gray-200 font-mono text-xs">
                {typeof v === "boolean" ? (v ? "✅" : "❌") : v === undefined ? "—" : String(v)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="text-xs text-gray-500 mt-4">
        {audit.chineseMessage}
      </div>
    </div>
  );
}
