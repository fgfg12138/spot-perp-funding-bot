"use client";

import { useEffect, useState } from "react";

export default function ReviewPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/review").then(r => r.json()).then(setData).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">复盘中心</h2>

      {data?.persistenceLabel && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded p-3 mb-4 text-xs text-amber-300">
          ⚠️ {data.persistenceLabel}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <ReviewCard label="总记录数" value={String(data?.totalRecords ?? 0)} />
        <ReviewCard label="机会记录" value={String(data?.opportunity_records?.length ?? 0)} />
        <ReviewCard label="入场决策" value={String(data?.entry_decisions?.length ?? 0)} />
        <ReviewCard label="入场执行" value={String(data?.entry_executions?.length ?? 0)} />
        <ReviewCard label="持仓快照" value={String(data?.position_snapshots?.length ?? 0)} />
        <ReviewCard label="资金费结算" value={String(data?.funding_settlements?.length ?? 0)} />
        <ReviewCard label="平仓记录" value={String(data?.exit_executions?.length ?? 0)} />
        <ReviewCard label="最终复盘" value={String(data?.final_reviews?.length ?? 0)} />
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-purple-400">持久化状态</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">表名</th>
              <th className="text-right py-2">记录数</th>
            </tr>
          </thead>
          <tbody>
            {["opportunity_records", "entry_decisions", "entry_executions", "position_snapshots", "funding_settlements", "exit_executions", "final_reviews"].map(t => (
              <tr key={t} className="border-b border-gray-800">
                <td className="py-2 font-mono text-xs">{t}</td>
                <td className="py-2 text-right">{data?.[t]?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-600 mt-2">持久化引擎: {data?.persistence ?? "未知"}</p>
      </div>
    </div>
  );
}

function ReviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-xl font-bold text-purple-400">{value}</div>
    </div>
  );
}
